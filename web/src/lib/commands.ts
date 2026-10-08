/**
 * Web'de gösterilen Dev Menu fonksiyonları.
 *
 * Telefon tarafındaki `helpers/developer/remote/RemoteCommands.ts` ile id'ler üzerinden eşleşir;
 * iki taraf ayrı kodlanır. Telefon `hello.commands` ile bildirmediği komutları web pasif gösterir.
 */

export type CommandOption = {label: string; args: unknown};

export type CommandDef = {
    id: string;
    title: string;
    description: string;
    group: CommandGroup;
    /** Varsa çalıştırmadan önce bu metinle onay istenir. */
    confirm?: string;
    danger?: boolean;
    /** Varsa kart bir seçim kutusu gösterir; seçilen seçeneğin `args`'ı gönderilir. */
    options?: CommandOption[];
};

export type CommandGroup = 'Modallar' | 'Ödeme' | 'Rate Us' | 'Cihaz' | 'Tehlikeli';

export const COMMAND_GROUPS: CommandGroup[] = ['Modallar', 'Ödeme', 'Rate Us', 'Cihaz', 'Tehlikeli'];

const indexOptions = (labels: string[]): CommandOption[] => labels.map((label, index) => ({label, args: {index}}));

export const COMMANDS: CommandDef[] = [
    {id: 'tryBoost', title: 'Try Boost', description: 'Hediye Boost modalını gösterir.', group: 'Modallar'},
    {id: 'trySuperLike', title: 'Try Super Like', description: 'Hediye Super Like modalını gösterir.', group: 'Modallar'},
    {id: 'kopukluAd', title: 'Köpüklü Reklam', description: 'Köpüklü reklam modalını (V2) gösterir.', group: 'Modallar'},
    {id: 'successStoriesIntro', title: 'Success Stories Intro', description: 'Başarı hikayeleri tanıtım modalını gösterir.', group: 'Modallar'},
    {id: 'pushPermission', title: 'Push Bildirim İzni', description: 'Push bildirim izni isteme modalını gösterir.', group: 'Modallar'},

    {id: 'giftModal.gold', title: 'Hediye Gold', description: 'Hediye Gold modalını gösterir.', group: 'Ödeme'},
    {id: 'giftModal.platinum', title: 'Hediye Platinum', description: 'Hediye Platinum modalını gösterir.', group: 'Ödeme'},
    {id: 'checkPaymentPixels', title: 'Payment Pixel Kontrolü', description: "Bekleyen ödeme pixel'ini manuel olarak çekip tüketir.", group: 'Ödeme'},
    {id: 'adaptyPaywallSeen', title: 'Adapty PaywallSeen (GOLD)', description: 'Adapty paywall görüldü logunu gönderir (geçici).', group: 'Ödeme'},

    {id: 'rateUs.showDecision', title: 'Rate Us Kararı', description: 'Kayıtlı Rate Us kararını gösterir.', group: 'Rate Us'},
    {
        id: 'rateUs.setDecision',
        title: 'Rate Us Kararını Ayarla',
        description: 'Rate Us kararını seçilen değere ayarlar.',
        group: 'Rate Us',
        options: indexOptions(['notShown', 'yes_yes', 'yes_no', 'no_yes', 'no_no']),
    },
    {
        id: 'rateUs.setLastTime',
        title: 'Son Rate Us Zamanı',
        description: 'Son Rate Us gösterim zamanını geriye alır.',
        group: 'Rate Us',
        options: indexOptions([
            '1 Dakika Önce', '30 Dakika Önce', '1 Saat Önce', '2 Saat Önce', '5 Saat Önce', '12 Saat Önce',
            '1 Gün Önce', '2 Gün Önce', '5 Gün Önce', '7 Gün Önce', '1 Ay Önce', '2 Ay Önce', '3 Ay Önce', '6 Ay Önce',
        ]),
    },
    {id: 'rateUs.showPopup', title: 'Rate Us Popup', description: 'Rate Us popup’ını hemen gösterir.', group: 'Rate Us'},
    {id: 'rateUs.reset', title: 'Rate Us Verilerini Sıfırla', description: 'Karar, son gösterim zamanı ve sayaçları sıfırlar.', group: 'Rate Us', confirm: 'Rate Us verileri sıfırlansın mı?'},

    {
        id: 'clearDeviceInfo',
        title: 'StoreDeviceInfo Sil',
        description: "AsyncStorage'daki deviceInfo-zustandStorage kaydını siler.",
        group: 'Cihaz',
        confirm: 'StoreDeviceInfo silinsin mi?',
        danger: true,
    },

    {
        id: 'errorOsman',
        title: 'Error Osman',
        description: 'Kasıtlı JS hatası fırlatır (BugSnag testi). Uygulama hata ekranına düşebilir.',
        group: 'Tehlikeli',
        confirm: 'Telefonda kasıtlı bir hata fırlatılacak. Devam edilsin mi?',
        danger: true,
    },
    {
        id: 'closeDevMenu',
        title: 'Dev Menu’yü Kapat',
        description: "Telefonda Dev Menu'yü kapatır; Remote bağlantısı da kesilir. Tekrar açmak için gizli butona basılması gerekir.",
        group: 'Tehlikeli',
        confirm: "Dev Menu kapatılacak ve bağlantı kesilecek. Emin misin?",
        danger: true,
    },
];
