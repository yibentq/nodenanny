'use strict';

// 流量池自愈生态·批次三第三步:订阅链接里"应急/备用节点"标注文字的五语言字典。
//
// 定位说明(交接文档7.3.5节明确要求的场景):这里的"语言"跟面板网页本身的语言切换
// (public/index.html里那套基于浏览器localStorage的I18N)是两回事——面板是给人在
// 浏览器里看的,语言可以随时点按钮切换;但订阅链接里塞进vless://...#这里的文字,
// 是直接被Shadowrocket/Clash这类客户端App当成"节点名称"原样显示的,客户端不会
// 帮你翻译。这段文字只能在生成订阅内容的这一刻(服务器端)就决定用哪种语言,而且
// 应该跟随用户当初部署时在终端选择的语言(config.language,来自install.sh里的
// NN_LANG),不能不管三七二十一固定写死中文。
//
// 只覆盖这一个具体场景需要的两个字符串,不做成通用翻译框架——如果以后订阅内容里
// 还需要别的会被用户看到的文案,再照这个模式加。

// 批次五·第三批改动(创始人明确要求):主节点订阅名字不再"追加后缀"，改成不管原链接
// 自带什么名字，一律整个替换成这条固定品牌文案(五语言)，直接把"这是NodeNanny的智能
// 节点、带自愈功能"这个信息说清楚。原来的mainNodeSuffix(追加后缀那套写法)已废弃删除，
// 不再使用，避免留死代码——如果以后又要改回"追加"这种模式，需要重新设计，不要指望
// 这里还留着旧字段可以直接抄。
const LABELS = {
  zh: {
    backupSuffix: '(应急-陌生服务器)',
    backupDefaultName: 'NodeNanny 应急节点',
    backupSuffixTrial: '(应急-陌生服务器·新来源观察期)',
    backupDefaultNameTrial: 'NodeNanny 应急节点(观察期来源)',
    mainNodeDefaultName: 'NodeNanny 智能节点 · 独特自愈功能',
    backupNodeWord: '备用节点',
    protocolUnknown: '未知协议'
  },
  en: {
    backupSuffix: '(Backup - Unknown Server)',
    backupDefaultName: 'NodeNanny Backup',
    backupSuffixTrial: '(Backup - Unverified New Source)',
    backupDefaultNameTrial: 'NodeNanny Backup (Trial Source)',
    mainNodeDefaultName: 'NodeNanny Smart Node · Self-Healing',
    backupNodeWord: 'Backup Node',
    protocolUnknown: 'Unknown Protocol'
  },
  ja: {
    backupSuffix: '(予備-見知らぬサーバー)',
    backupDefaultName: 'NodeNanny 予備ノード',
    backupSuffixTrial: '(予備-新規未検証ソース)',
    backupDefaultNameTrial: 'NodeNanny 予備ノード(試用中ソース)',
    mainNodeDefaultName: 'NodeNanny スマートノード・自己修復機能',
    backupNodeWord: '予備ノード',
    protocolUnknown: '不明なプロトコル'
  },
  de: {
    backupSuffix: '(Notfall - Fremder Server)',
    backupDefaultName: 'NodeNanny Notfallknoten',
    backupSuffixTrial: '(Notfall - Ungeprüfte neue Quelle)',
    backupDefaultNameTrial: 'NodeNanny Notfallknoten (Testquelle)',
    mainNodeDefaultName: 'NodeNanny Smart Node · Selbstheilungsfunktion',
    backupNodeWord: 'Ersatzknoten',
    protocolUnknown: 'Unbekanntes Protokoll'
  },
  ru: {
    backupSuffix: '(Резерв - чужой сервер)',
    backupDefaultName: 'NodeNanny Резервный узел',
    backupSuffixTrial: '(Резерв - непроверенный новый источник)',
    backupDefaultNameTrial: 'NodeNanny Резервный узел (тестовый источник)',
    mainNodeDefaultName: 'NodeNanny Умный узел · Функция самовосстановления',
    backupNodeWord: 'Резервный узел',
    protocolUnknown: 'Неизвестный протокол'
  }
};

const SUPPORTED_LANGS = Object.keys(LABELS);

function resolveLang(lang) {
  return LABELS[lang] ? lang : 'zh';
}

// tier: 'trial'(试用期、尚未验证的GitHub发现来源) | 不传/其他值(legacy aggregator
// 或已转正来源,走原有文案)——复查发现问题9新增,向后兼容:不传tier时行为跟改动前完全一致。
function getBackupSuffix(lang, tier) {
  const l = LABELS[resolveLang(lang)];
  return tier === 'trial' ? l.backupSuffixTrial : l.backupSuffix;
}

function getBackupDefaultName(lang, tier) {
  const l = LABELS[resolveLang(lang)];
  return tier === 'trial' ? l.backupDefaultNameTrial : l.backupDefaultName;
}

function getMainNodeDefaultName(lang) {
  return LABELS[resolveLang(lang)].mainNodeDefaultName;
}

function getBackupNodeWord(lang) {
  return LABELS[resolveLang(lang)].backupNodeWord;
}

function getProtocolUnknownText(lang) {
  return LABELS[resolveLang(lang)].protocolUnknown;
}

module.exports = {
  getBackupSuffix,
  getBackupDefaultName,
  getMainNodeDefaultName,
  getBackupNodeWord,
  getProtocolUnknownText,
  SUPPORTED_LANGS
};
