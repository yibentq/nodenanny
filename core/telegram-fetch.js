'use strict';

// Telegram公开频道"当天最新文件"抓取(2026-07-30新增,founder已明确确认接受
// 这个方案的权衡,见交接文档记录)。
//
// 背景:manualSources想直接支持"给一个TG频道链接,自动去抓当天分享的节点文件",
// 但项目没有Telegram Bot API的token/登录凭证,唯一能不登录就访问的入口是Telegram
// 自带的"公开预览页"(t.me/s/频道名),这不是官方API,是网页版展示层,能力上限:
//   - 只能看到最近几十条消息(具体数字Telegram不承诺,不是可以翻到任意历史)
//   - 频道自己设了"禁止非登录用户预览",或者改版换了HTML结构,这里就会直接失效
//   - 不是"像人一样点开APP操作",只是读一个公开静态HTML页面
// 这个上限已经跟founder明确确认过可以接受,不是本模块自己偷偷降低要求。
//
// 实现方式:不引入新的HTML解析依赖(项目目前没有cheerio这类库),用字符串切分+正则
// 从公开预览页的HTML里按消息切块,从最新(页面最下面)往回找,取第一条带"文件附件"
// (tgme_widget_message_document_wrap)或者消息正文里带http(s)链接的消息,把找到的
// 链接返回给调用方去真正抓取内容(调用方应该复用core/repo-fetch.js的fetchText,
// 不要在这里重新实现一套HTTP客户端——本模块的fetchText通过参数注入,不内置)。
//
// !!! 重要,如实标注:这部分HTML结构提取逻辑,是按Telegram公开预览页过往已知的
// DOM结构写的(tgme_widget_message_wrap / tgme_widget_message_document_wrap /
// tgme_widget_message_text 这些class名)。2026-07-30会话查了公开资料
// (RSSHub项目的/telegram/channel路由、一篇2026年4月的技术博客)佐证这几个
// class名截至目前仍然是对的。
//
// !!! 2026-07-30同日晚些时候,又一次会话通过不受本沙盒网络白名单限制的抓取
// 工具(不是node/bash里的HTTP请求,是另一条通道),真实拿到了@jiedian168今天
// (2026-07-30)的频道页面内容,这是本模块第一次真正见到live数据,不再是纯
// 假设。好消息:频道确实每天更新,当天(7.30)确实发了"7.30免费节点.txt",
// 命名规律、每天消息ID都不同(链接会变,不是固定URL)这些都跟之前假设的一致。
//
// 坏消息,而且是比"DOM class名过没过时"更底层的问题:抓到的真实页面里,
// "文件那一行"渲染出来的实际链接,指向的是这条消息本身的页面
// (形如 https://t.me/jiedian168/1265),不是能直接下载到txt内容的地址。
// 页面上文件那条紧跟着还写了"Please open Telegram to view this post"——
// 这正是Telegram对"需要在真正客户端里才能打开"的内容显示的提示语。
// 换句话说:DOCUMENT_HREF_RE抓到的href,拿去给调用方(core/pool.js里的
// fetchFromManualSource)当"节点文件的URL"用,repoFetch.fetchText()抓回来的
// 很可能只是这个消息的HTML外壳页面,parseSubscriptionContent()从里面解析不出
// 任何真实节点——不是"抓错了链接",是"这条路径能抓到的从来就不是文件本体"。
//
// 独立佐证(不只是这一次抓取的孤证):
// 1) 查了RSSHub(https://github.com/DIYgod/RSSHub,一个成熟、维护多年、专门做
//    "把t.me/s/页面转成RSS"这件事的开源项目)的真实源码
//    (lib/routes/telegram/channel.ts)。它对tgme_widget_message_document_wrap
//    的处理,只提取了documentTitle(文件名)和documentExtra(文件大小)两个
//    文本字段,自始至终没有尝试从这个元素上取一个"下载用的href"。一个做了
//    这么久、issue列表里连"回复消息引用文本抓错"这种细节都有人报过bug的成熟
//    项目,如果公开预览页真的能拿到文件直链,没有理由不做这个最基本的功能
//    ——这从侧面印证了"拿不到"更可能是真的,而不是RSSHub没做全。
// 2) Apify的Telegram Channels Scraper(一个商业化的频道抓取SaaS产品)公开的
//    输出数据结构示例里,每条message只有id/date/text/views/author这些字段,
//    同样没有文件下载链接字段。
// 3) 搜到的"Telegram Restricted Media Downloader"这类专门解决"频道文件下不
//    下来"问题的开源工具,用的是Pyrogram(真正登录的Telegram API客户端),
//    不是网页抓取——如果网页抓取就能拿到文件,这类工具存在的意义会小很多。
//
// 这三条独立证据方向一致,指向同一个结论:Telegram的公开预览页(不登录、
// 没有Bot token/API凭证的那个入口)大概率从设计上就不暴露文件附件的可下载
// 直链,只暴露"这条消息存在、文件名是什么、多大"这些元信息,文件本体必须
// 在真正的客户端(或用Bot API/MTProto登录后的API)里才能拿到。这跟"DOM结构
// 会不会过时"是两个层面的问题——哪怕class名以后一直不变,document_attachment
// 这条路径大概率也从来没法真正抓到节点文件内容,不是"能力上限已知且接受"里
// 说的那种"未来可能失效",而是"现在可能就没真正成功过"。
//
// 这个结论目前还不是100%坐实:抓取工具把原始HTML转成了Markdown再呈现出来,
// 理论上无法完全排除"原始<a>标签其实还有另一个未被转换保留下来的属性/子元素
// 指向真实文件"这种小概率可能。但综合三条独立佐证,可信度已经比较高,不建议
// 在没有相反证据前假设document_attachment路径能正常工作。
//
// 本次会话做的事:不再对这个不确定性保持沉默——下面fetchLatestFileUrl()新增
// 了MESSAGE_PERMALINK_RE识别,一旦document_attachment路径抓到的href长得就是
// "频道名/纯数字消息ID"这种消息永久链接形态,不再当成"成功抓到文件"直接返回
// ok:true,而是明确判定为这个已知的可疑情况,返回一个专门的错误原因,让下游
// (core/pool.js/founder)能一眼看出"不是网络失败,是这条路径本身可能不通",
// 而不是被误判成"这轮该源没抓到可用节点"这种普通失败、然后在trial状态机里
// 被悄悄扣分甚至拉黑,却没人知道真正原因。message_text_link这条路径(消息
// 正文里直接贴的文字链接,不是文件附件)不受这个问题影响,继续按原逻辑处理。
//
// 下一个AI/founder如果要彻底解决(而不只是诚实地报错),大概率绕不开这两条路
// 之一:(a)给频道加一个Telegram Bot、用Bot API的getFile/downloadFile;
// (b)走MTProto登录客户端(如telethon/pyrogram/gramjs)。这两条路都需要新的
// 凭证(Bot token 或 手机号登录),都是之前"没有Telegram登录凭证"这个前提下
// 被明确排除掉的——如果founder决定要继续做这个功能,这个前提本身可能需要
// 重新拿到founder那里确认是否要引入新凭证,不应该由AI单方面假设可以引入。

const MESSAGE_WRAP_MARKER = 'class="tgme_widget_message_wrap';
const DOCUMENT_HREF_RE = /class="tgme_widget_message_document_wrap[^"]*"[^>]*href="([^"]+)"/;
// 2026-07-30修复:只匹配"消息正文"的text块,排除"引用/回复的原消息"那段text块。
// 起因:查资料时发现Telegram预览页对"回复了某条消息"的消息,会在正文前面额外插入
// 一段被回复内容的引用摘要,这段引用摘要的HTML元素同时带有
// tgme_widget_message_reply 和 tgme_widget_message_text 两个class(空格分隔在
// 同一个class属性里),而消息本体的正文元素只带 tgme_widget_message_text,不带
// reply。旧版本的正则会无差别抓"最先出现的tgme_widget_message_text",如果最新
// 一条消息恰好是"回复"某条旧消息,就会抓错——把引用摘要里的链接当成正文链接。
// 这里改成:枚举一个消息块里所有text块,跳过class属性里同时含reply的那些,
// 只用真正的正文块。
const TEXT_BLOCK_G_RE = /<div class="([^"]*)tgme_widget_message_text([^"]*)"[\s\S]*?<\/div>/g;
const HREF_IN_TEXT_RE = /href="(https?:\/\/[^"]+)"/g;

// 2026-07-30新增:识别"这个链接其实就是Telegram消息本身的永久链接"
// (形如 https://t.me/频道名/123,频道名后面直接跟纯数字消息ID,没有更多路径)。
// 起因见文件头本次会话的大段说明:实测+RSSHub源码+Apify输出结构+专用下载器
// 工具的存在这几条独立证据,都指向"document_attachment抓到的href很可能就是
// 这种消息永久链接,不是能下到文件内容的直链"。这个正则专门用来把这种已知
// 可疑情况和"真的抓到一个外部文件直链"区分开,不要混为一谈地都当成成功。
const MESSAGE_PERMALINK_RE = /^https?:\/\/(?:t|telegram)\.me\/[A-Za-z0-9_]+\/\d+\/?(?:\?.*)?$/;

// 判断一个URL是不是"频道链接"(t.me/频道名 或 t.me/s/频道名),不是具体某条消息的链接
// (消息链接形如 t.me/频道名/123,带数字消息ID,不在这个函数的匹配范围内 —— 那种应该
// 当成普通URL走原有的repo-fetch逻辑,不需要经过这层"找当天最新文件"的额外跳转)。
function isTelegramChannelUrl(url) {
  if (typeof url !== 'string') return false;
  return /^https?:\/\/(?:t|telegram)\.me\/(?:s\/)?[A-Za-z0-9_]+\/?(?:\?.*)?$/.test(url.trim());
}

function normalizeToPreviewUrl(url) {
  const m = url.trim().match(/^https?:\/\/(?:t|telegram)\.me\/(?:s\/)?([A-Za-z0-9_]+)\/?(?:\?.*)?$/);
  if (!m) return null;
  return `https://t.me/s/${m[1]}`;
}

function splitMessageBlocks(html) {
  const parts = html.split(MESSAGE_WRAP_MARKER);
  // 第一段是页面头部(不是消息内容),从第二段开始每段对应一条消息。
  return parts.slice(1);
}

function resolveHref(href) {
  if (!href) return null;
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `https://t.me${href}`;
  return href;
}

// 从一条消息块里找"真正正文"的text块内容(排除reply引用摘要块)。
// 找不到合格的正文块就返回null,调用方按"这条消息没有可用文字链接"处理。
function extractBodyTextBlock(block) {
  TEXT_BLOCK_G_RE.lastIndex = 0;
  let match;
  while ((match = TEXT_BLOCK_G_RE.exec(block)) !== null) {
    const classBefore = match[1] || '';
    const classAfter = match[2] || '';
    const fullClassAttr = `${classBefore}tgme_widget_message_text${classAfter}`;
    if (fullClassAttr.includes('reply')) {
      // 这是引用/回复摘要块,跳过,继续找下一个text块。
      continue;
    }
    return match[0];
  }
  return null;
}

// 主入口:给一个频道链接(t.me/频道名 或 t.me/s/频道名 都行)+ 一个复用自
// core/repo-fetch.js的fetchText函数,返回该频道最近一条"带可下载文件或链接"
// 的消息里,那个链接的绝对URL;找不到就返回 ok:false + 具体原因。
async function fetchLatestFileUrl(channelUrl, { fetchText } = {}) {
  const previewUrl = normalizeToPreviewUrl(channelUrl);
  if (!previewUrl) return { ok: false, error: 'not_a_telegram_channel_url' };
  if (typeof fetchText !== 'function') {
    return { ok: false, error: 'fetchText_impl_required' };
  }

  let html;
  try {
    html = await fetchText(previewUrl);
  } catch (err) {
    return { ok: false, error: `fetch_failed: ${err.message}` };
  }

  const blocks = splitMessageBlocks(html);
  if (blocks.length === 0) {
    return { ok: false, error: 'no_messages_found_check_channel_access_or_html_structure' };
  }

  // 记录"document_attachment命中过,但href长得像消息永久链接"这种已知可疑情况
  // 出现过几次——如果最终什么都没抓到,要用这个来给出更准确的失败原因,而不是
  // 笼统地说"没找到链接"(那样会掩盖"其实找到了,只是大概率不能用"这个真相)。
  let suspiciousDocumentPermalinkCount = 0;

  // 从最后一条(页面最下面=最新)往前找,第一条能提取出链接的就用它——不是每条消息
  // 都会带文件,允许跳过纯文字公告类消息去找更早一点的那条真正带文件的。
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];

    const docMatch = block.match(DOCUMENT_HREF_RE);
    if (docMatch) {
      const href = resolveHref(docMatch[1]);
      if (href) {
        if (MESSAGE_PERMALINK_RE.test(href)) {
          // 2026-07-30新增:这正是文件头大段说明里记录的已知可疑情况——抓到的
          // href只是这条消息自己的永久链接,不是文件直链。不当成成功返回,而是
          // 记一笔,继续往更早的消息找(万一某条消息的文件附件恰好是别的形态,
          // 比如转发自带外部直链的情况——没验证过是否存在,但不应该提前放弃)。
          suspiciousDocumentPermalinkCount += 1;
        } else {
          // href不是消息永久链接形态,是真正看起来独立的地址,按原逻辑当成功返回。
          return { ok: true, url: href, source: 'document_attachment', scannedBack: blocks.length - 1 - i };
        }
      }
    }

    const bodyTextBlock = extractBodyTextBlock(block);
    if (bodyTextBlock) {
      const hrefMatches = [...bodyTextBlock.matchAll(HREF_IN_TEXT_RE)];
      if (hrefMatches.length > 0) {
        // 消息正文里可能不止一个链接,这里取第一个 —— 如实标注:没有做"哪个链接
        // 更像节点订阅文件"的智能判断(比如优先选.txt/.yaml/.json结尾的),如果
        // 正文里混了无关链接(频道自己的推广/群组链接排在前面),这里可能会挑错。
        // 需要拿真实频道的真实消息验证后,再决定要不要加更精细的筛选逻辑。
        return { ok: true, url: hrefMatches[0][1], source: 'message_text_link', scannedBack: blocks.length - 1 - i };
      }
    }
  }

  if (suspiciousDocumentPermalinkCount > 0) {
    // 明确区分开"根本没找到任何链接"和"找到过,但已知大概率是消息永久链接、
    // 不是文件本体"这两种情况——后者需要founder/下一个AI去解决"要不要引入
    // Bot API/登录凭证"这个更大的问题,不是简单重试或者换个正则能解决的。
    return {
      ok: false,
      error: 'document_links_found_but_all_were_message_permalinks_not_direct_file_urls',
      suspiciousCount: suspiciousDocumentPermalinkCount
    };
  }

  return { ok: false, error: 'no_link_found_in_recent_messages' };
}

module.exports = {
  isTelegramChannelUrl,
  normalizeToPreviewUrl,
  fetchLatestFileUrl
};
