import { Component, OnInit, Input, ChangeDetectionStrategy, OnChanges, Output, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { StateService } from '../../services/state.service';
import { Observable, ReplaySubject, BehaviorSubject, merge, Subscription } from 'rxjs';
import { Outspend, Transaction, Vin, Vout } from '../../interfaces/electrs.interface';
import { ElectrsApiService } from '../../services/electrs-api.service';
import { environment } from 'src/environments/environment';
import { AssetsService } from 'src/app/services/assets.service';
import { filter, map, tap, switchMap } from 'rxjs/operators';
import { BlockExtended } from 'src/app/interfaces/node-api.interface';
import { ApiService } from 'src/app/services/api.service';

@Component({
  selector: 'app-transactions-list',
  templateUrl: './transactions-list.component.html',
  styleUrls: ['./transactions-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TransactionsListComponent implements OnInit, OnChanges {
  network = '';
  nativeAssetId = this.stateService.network === 'liquidtestnet' ? environment.nativeTestAssetId : environment.nativeAssetId;

  @Input() transactions: Transaction[];
  @Input() showConfirmations = false;
  @Input() transactionPage = false;
  @Input() errorUnblinded = false;
  @Input() paginated = false;
  @Input() outputIndex: number;
  @Input() address: string = '';

  @Output() loadMore = new EventEmitter();

  latestBlock$: Observable<BlockExtended>;
  outspendsSubscription: Subscription;
  refreshOutspends$: ReplaySubject<string[]> = new ReplaySubject();
  refreshChannels$: ReplaySubject<string[]> = new ReplaySubject();
  showDetails$ = new BehaviorSubject<boolean>(false);
  outspends: Outspend[][] = [];
  assetsMinimal: any;
  channels: { inputs: any[], outputs: any[] };

  constructor(
    public stateService: StateService,
    private electrsApiService: ElectrsApiService,
    private apiService: ApiService,
    private assetsService: AssetsService,
    private ref: ChangeDetectorRef,
  ) { }

  ngOnInit() {
    this.latestBlock$ = this.stateService.blocks$.pipe(map(([block]) => block));
    this.stateService.networkChanged$.subscribe((network) => this.network = network);

    if (this.network === 'liquid' || this.network === 'liquidtestnet') {
      this.assetsService.getAssetsMinimalJson$.subscribe((assets) => {
        this.assetsMinimal = assets;
      });
    }

    this.outspendsSubscription = merge(
      this.refreshOutspends$
        .pipe(
          switchMap((txIds) => this.apiService.getOutspendsBatched$(txIds)),
          tap((outspends: Outspend[][]) => {
            this.outspends = this.outspends.concat(outspends);
          }),
        ),
      this.stateService.utxoSpent$
        .pipe(
          tap((utxoSpent) => {
            for (const i in utxoSpent) {
              this.outspends[0][i] = {
                spent: true,
                txid: utxoSpent[i].txid,
                vin: utxoSpent[i].vin,
              };
            }
          }),
        ),
        this.refreshChannels$
          .pipe(
            filter(() => this.stateService.env.LIGHTNING),
            switchMap((txIds) => this.apiService.getChannelByTxIds$(txIds)),
            map((channels) => {
              this.channels = channels;
            }),
          )
        ,
    ).subscribe(() => this.ref.markForCheck());
  }

  ngOnChanges() {
    if (!this.transactions || !this.transactions.length) {
      return;
    }
    if (this.paginated) {
      this.outspends = [];
    }
    if (this.outputIndex) {
      setTimeout(() => {
        const assetBoxElements = document.getElementsByClassName('assetBox');
        if (assetBoxElements && assetBoxElements[0]) {
          assetBoxElements[0].scrollIntoView();
        }
      }, 10);
    }

    this.transactions.forEach((tx, i) => {
      tx['@voutLimit'] = true;
      tx['@vinLimit'] = true;
      if (this.outspends[i]) {
        return;
      }

      if (this.address) {
        const addressIn = tx.vout
          .filter((v: Vout) => v.scriptpubkey_address === this.address)
          .map((v: Vout) => v.value || 0)
          .reduce((a: number, b: number) => a + b, 0);

        const addressOut = tx.vin
          .filter((v: Vin) => v.prevout && v.prevout.scriptpubkey_address === this.address)
          .map((v: Vin) => v.prevout.value || 0)
          .reduce((a: number, b: number) => a + b, 0);

        tx['addressValue'] = addressIn - addressOut;
      }
    });
    const txIds = this.transactions.map((tx) => tx.txid);
    this.refreshOutspends$.next(txIds);
    this.refreshChannels$.next(txIds);
  }

  onScroll() {
    const scrollHeight = document.body.scrollHeight;
    const scrollTop = document.documentElement.scrollTop;
    if (scrollHeight > 0){
      const percentageScrolled = scrollTop * 100 / scrollHeight;
      if (percentageScrolled > 70){
        this.loadMore.emit();
      }
    }
  }

  haveBlindedOutputValues(tx: Transaction): boolean {
    return tx.vout.some((v: any) => v.value === undefined);
  }

  getTotalTxOutput(tx: Transaction) {
    return tx.vout.map((v: Vout) => v.value || 0).reduce((a: number, b: number) => a + b);
  }

  switchCurrency() {
    if (this.network === 'liquid' || this.network === 'liquidtestnet') {
      return;
    }
    const oldvalue = !this.stateService.viewFiat$.value;
    this.stateService.viewFiat$.next(oldvalue);
  }

  trackByFn(index: number, tx: Transaction): string {
    return tx.txid + tx.status.confirmed;
  }

  trackByIndexFn(index: number) {
    return index;
  }

  formatHex(num: number): string {
    const str = num.toString(16);
    return '0x' + (str.length % 2 ? '0' : '') + str;
  }

  pow(base: number, exponent: number): number {
    return Math.pow(base, exponent);
  }

  toggleDetails() {
    if (this.showDetails$.value === true) {
      this.showDetails$.next(false);
    } else {
      this.showDetails$.next(true);
    }
  }

  loadMoreInputs(tx: Transaction) {
    tx['@vinLimit'] = false;

    this.electrsApiService.getTransaction$(tx.txid)
      .subscribe((newTx) => {
        tx.vin = newTx.vin;
        tx.fee = newTx.fee;
        this.ref.markForCheck();
      });
  }

  ngOnDestroy() {
    this.outspendsSubscription.unsubscribe();
  }
}
