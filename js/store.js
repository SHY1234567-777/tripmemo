/* ============================================================
   TripMemo 数据层（js/store.js）

   职责：所有数据的读写都从这里走 —— 全项目唯一的"数据出口"。
   为什么单独一个文件：以后换成云数据库时，只需要改这一个文件，
                      界面代码一行都不用动（见 TECH_DESIGN 2.3）。

   ⭐ 存储位置（Day 20 起）：**云数据库**，通过公网接口读写。
      ⚠️ 之前是浏览器 localStorage —— 换设备就没了、别人也看不到。
   Day 7 · 步骤 2b ｜ Day 20 接到公网接口
   ============================================================ */

(function (global) {
  'use strict';

  var Model = global.TripMemoModel;

  /* ------------------------------------------------------------
     ⭐⭐ 接口地址（Day 20）
     ------------------------------------------------------------
     ⚠️ 为什么本地和公网要用不同地址：
        · 公网页面（静态托管域名 .tcloudbaseapp.com）**必须直连云函数地址** ——
          因为静态托管的域名下面**没有 /api** 这个东西。
        · 本地调试时**不能直连** —— ⚠️ CloudBase 免费版不让把 localhost 加进
          跨域白名单（要付费），所以本地直连会被网关拦掉（CORS 错误）。
          ⭐ 解决办法：本地起一个代理（仓库根目录的 dev-proxy.py），
             它同时提供静态文件和转发 /api —— 于是页面和接口**同源**，不触发跨域。
     ------------------------------------------------------------ */
  var API_BASE = (function () {
    var h = global.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '') {
      return '';   /* ⭐ 本地：空串 = 相对路径 = 走本地代理（同源） */
    }
    /* ⭐ 公网：直连云函数 */
    return 'https://tripmemo-d3gd23bd14a396d1d-148733444.ap-shanghai.app.tcloudbase.com';
  }());

  /* ------------------------------------------------------------
     ⭐⭐ 身份认证（Day 20）
     ------------------------------------------------------------
     ⚠️ 为什么必须加这个：
        以前云函数里写死了 `CURRENT_USER_ID = 'u_shy'` ——
        所以**谁打开都看到同一份数据**（都是 shy 的）。
        ⭐ 现在改成匿名登录：每个浏览器自动获得一个**自己的**身份。

     ⚠️ 为什么用「匿名登录」而不是账号密码：
        不用注册、不用填东西，打开就有身份。
        ⭐ 代价：换浏览器/清缓存会变成"新用户"（数据看不到了）。
        以后要"换设备也能看到自己的"，再升级成真正的账号登录。

     ⭐ 登录后的操作顺序（每一步都不能省）：
        ① init SDK
        ② 看有没有现存会话（有 = 之前登录过，不用再登）
        ③ 没有 → signInAnonymously()
        ④ 从会话里取出 access_token → ⭐ 之后每个请求都带上它
     ------------------------------------------------------------ */
  var CLOUD_ENV = 'tripmemo-d3gd23bd14a396d1d';
  var cbaApp = null;     /* ⭐ SDK 实例 —— 上传照片要用它 */
  var cbaAuth = null;
  var accessToken = null;
  var authError = null;

  /**
   * ⭐ 建立身份（页面启动时调用一次）
   * @returns {Promise<boolean>} 成功 true
   * ⚠️ 失败**不阻断**页面 —— 只是这个请求不带身份，云函数会用它的兜底用户。
   */
  function initAuth() {
    authError = null;

    if (typeof global.cloudbase === 'undefined') {
      authError = 'CloudBase SDK 没加载（检查 index.html 里的 script 标签顺序）';
      return Promise.resolve(false);
    }

    var app;
    try {
      app = global.cloudbase.init({ env: CLOUD_ENV, region: 'ap-shanghai' });
      cbaApp = app;    /* ⭐ 存到外层，上传照片时要用 */

      /* ⚠️⚠️ 这里有个踩过的坑（Day 20）：
         取 auth 的方式在**新旧大版本之间不一样** ——
           · v3（最新）：`app.auth` 是**属性** → 直接取
           · v2（旧）：  `app.auth` 是**方法** → 要调用
         ⭐ 之前固定用了旧版 2.17.3，结果报
            "cbaAuth.getSession is not a function" —— 页面直接白屏。
         ⭐ 所以：**两种都兼容**，而且**版本不对时明确报错**，不要静默失败。 */
      cbaAuth = (typeof app.auth === 'function') ? app.auth() : app.auth;

      if (!cbaAuth || typeof cbaAuth.signInAnonymously !== 'function') {
        authError = 'SDK 的认证接口和预期不一样（版本不匹配，signInAnonymously 不存在）';
        console.error('[TripMemo] ' + authError, app);
        return Promise.resolve(false);
      }
      if (typeof cbaAuth.getSession !== 'function') {
        authError = '当前 SDK 版本没有 getSession（需要 v3）—— index.html 里应引用 latest';
        console.error('[TripMemo] ' + authError, cbaAuth);
        return Promise.resolve(false);
      }
    } catch (err) {
      authError = '初始化认证失败：' + ((err && err.message) || err);
      console.error('[TripMemo] ' + authError, err);
      return Promise.resolve(false);
    }

    return cbaAuth.getSession().then(function (r) {
      /* ⭐ 已有会话 = 之前登录过，直接用，不要重复登录 */
      if (r && r.data && r.data.session) return null;
      return cbaAuth.signInAnonymously();
    }).then(function () {
      return cbaAuth.getSession();
    }).then(function (r) {
      var s = r && r.data && r.data.session;
      if (!s || !s.access_token) throw new Error('登录后没拿到 access_token');
      accessToken = s.access_token;
      console.log('[TripMemo] 已有身份，token 长度 ' + accessToken.length);
      return true;
    }).catch(function (err) {
      authError = '登录失败：' + ((err && err.message) || err);
      console.error('[TripMemo] 认证失败：', err);
      return false;
    });
  }

  /**
   * ⭐ 统一的接口请求封装（Day 20）
   *
   * ⚠️ 为什么必须统一走这里，而不是各处写 fetch：
   *    接口的应答有好几种情况（成功 / 400 参数错 / 409 重复 / 500 崩了），
   *    每处的处理方式必须一致 —— 散着写一定会漏掉某一种。
   *
   * @param {string} method 'GET' | 'POST'
   * @param {string} path   如 '/api/places'
   * @param {object} [body] 有 body 就发 JSON
   * @returns {Promise<{status:number, json:object|null}>}
   *          ⚠️ **即使 HTTP 状态是 400/409 也 resolve** —— 因为那是接口的正常应答，
   *             不是"网络坏了"。真连不上才 reject。
   */
  function requestJson(method, path, body) {
    var opts = { method: method, headers: {} };
    /* ⭐ 带上身份 —— 云函数靠它判断"这是谁"，而不是靠写死的用户 */
    if (accessToken) {
      opts.headers['Authorization'] = 'Bearer ' + accessToken;
    }
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return global.fetch(API_BASE + path, opts).then(function (res) {
      return res.json().then(
        function (json) { return { status: res.status, json: json }; },
        function () { return { status: res.status, json: null }; }   /* 应答不是 JSON */
      );
    }).catch(function (err) {
      /* ⭐⭐ Day 23：把"网络层失败"翻译成中文人话
         ⚠️ 先分清一件事 —— 什么会走到这个 catch：
            · ✅ 会：断网 / DNS 解析不了 / 被代理拦了 / 云函数域名不可达 / 请求被 CORS 挡掉
            · ❌ 不会：HTTP 400 / 409 / 500 —— fetch **不把"服务器答了错误码"当失败**，
                     那些照常走上面的 then，由 errorMessageOf 按状态码翻译
         ⚠️ 浏览器给的原文是英文：Chrome 是 `Failed to fetch`，
            Firefox 是 `NetworkError when attempting to fetch resource` ——
            ⭐ 直接抛给用户等于没说，所以这里统一换成中文。
         ⭐ 原文照旧打进 Console（排查时不丢信息）。 */
      console.error('[TripMemo] 网络请求失败（' + method + ' ' + path + '）：', err);
      throw makeFriendlyError(
        'network',
        '网络连不上服务器，请检查网络后重试。',
        (err && err.message) ? err.message : String(err)
      );
    });
  }

  /**
   * ⭐ 造一个"给人看的"错误（Day 23）
   *
   * ⚠️ 为什么需要它：原来各处直接 `new Error(英文原文)`，而 reportError 会把
   *    `err.message` **原样显示在页面顶部** → 用户看到的是 `Failed to fetch`。
   * ⭐ 这里统一成一种形状：
   *    · `message` = 中文人话（这个会被显示出去）
   *    · `kind`    = 'network' / 'input' / 'server'，方便上层分辨是哪一类
   *    · `raw`     = 技术原文（只进 Console，不给用户看）
   */
  function makeFriendlyError(kind, message, raw) {
    var e = new Error(message);
    e.kind = kind;
    e.raw = raw || '';
    return e;
  }

  /**
   * ⭐ 从接口应答里取出"给用户看的中文提示"（Day 23 重写）
   *
   * ⚠️ 为什么要按状态码分开说，而不是一句"出错了"糊过去：
   *    三类错误的"用户能做什么"完全不同 ——
   *    · 输入错（400/409）→ 是**用户自己填错了**，服务端已经给了准确的中文
   *                          （比如"名称不能为空"），⭐ 照原样显示，用户能照着改
   *    · 服务端错（500+） → ⚠️ 是**我们这边的锅**，用户改什么都没用。
   *                          服务端返的是给开发者看的英文原文（如 connect ECONNREFUSED），
   *                          ⭐ **绝不能透传** —— 用户看不懂，而且**可能泄露服务器内部信息**
   *    · 形状不认识        → 兜底中文 + 状态码（方便对着 F12 的 Network 面板查）
   *
   * ⚠️ 契约 §3.1 规定的错误形状是 { ok:false, error:{ code, message } }
   */
  function errorMessageOf(result) {
    var j = result && result.json;
    var status = (result && result.status) || 0;

    /* ⭐ 服务端错：不管它返的是什么，一律换成中文人话；
       原文只写进 Console（开发者排查用），不进界面。 */
    if (status >= 500) {
      var rawServer = (j && j.error && (j.error.message || j.error)) || '(服务端没给原因)';
      console.warn('[TripMemo] 服务端出错（HTTP ' + status + '），原文只给开发者看：', rawServer);
      return '服务器处理出错，请稍后重试。';
    }

    /* ⭐ 服务端主动给的业务提示（400 校验 / 409 重复 / 404 找不到）——
       这些本来就是中文、而且是**准确的**，直接用（用户照着它就能改对） */
    if (j && j.error && j.error.message) return j.error.message;
    if (j && j.error && typeof j.error === 'string') return j.error;

    /* ⭐ 兜底：走到这说明应答的形状我们不认识（比如网关自己返回了错误页）。
       带上状态码，方便对着 F12 的 Network 面板查。 */
    if (!j) {
      return '服务器没有返回可识别的内容，请稍后重试。（HTTP ' + (status || '未知') + '）';
    }
    return '请求没有成功，请稍后重试。（HTTP ' + (status || '未知') + '）';
  }

  /* ⚠️ Day 20 起：地点和设置都存云数据库了，不再用 localStorage ——
     所以原来那两个键名（KEY_PLACES / KEY_SETTINGS）已经删掉。
     ⭐ 只有"装示例数据前的本地备份"还在用 localStorage（见下面的 KEY_BACKUP），
        因为那是"本地操作的保险"，本来就不该上云。 */

  /* 载入示例数据前，把用户原有数据备份到这个键（Day 8）
     只在"还没有备份"时才写 —— 防止手滑点两次把备份覆盖成示例数据 */
  var KEY_BACKUP = 'tripmemo.backup.v1';

  /* 内存中的缓存：避免每次都读 localStorage */
  var placesCache = null;
  var settingsCache = null;

  /* ⭐ 初始化（第一次从云端拉数据）是否失败（Day 20）
     ⚠️ 为什么单独一个变量、不复用 lastError：
        lastError 记的是"历史上最近一次错"，可能是很久以前保存失败留下的。
        ⭐ 而"这次打开页面加载失败"必须由这次加载自己报告 —— 否则会误报。 */
  var initError = null;

  /* 最近一次数据层错误（Day 8 新增）
     为什么要它：原来出错只写 console.error，用户看到的是一片空白，
                完全不知道发生了什么。现在把它记下来，由界面显示出来。 */
  var lastError = null;

  /**
   * 记一次数据层错误，并广播出去让界面显示
   * @param {string} scope 出错的环节（读地点 / 写地点 / 读设置 / 写设置）
   * @param {Error} err
   */
  function reportError(scope, err) {
    lastError = {
      scope: scope,
      message: (err && err.message) ? err.message : String(err)
    };
    console.error('[TripMemo] 数据层出错（' + scope + '）：', err);
    document.dispatchEvent(new CustomEvent('store:error', {
      detail: lastError
    }));
  }

  /* ------------------------------------------------------------
     一、底层读写
     ------------------------------------------------------------ */

  /** 从 localStorage 读出全部地点；第一次读会缓存 */
  /**
   * 读地点数据，并**如实报告"这一次读"的结果**（Day 13）
   *
   * ⚠️ 为什么需要它：原来读失败时 `placesCache` 会被设成 `[]`，
   *    上层看到的是"空数组"—— **和"真的没数据"长得一模一样**，
   *    于是"读失败"被显示成「还没有记录」，把用户往错的方向引。
   *
   * ⚠️ 为什么**不能**拿 `getLastError()` 当判据：它报的是"**历史上最近一次**错"，
   *    可能是很久以前"保存失败"留下的 —— **不是"这次读失败"**。
   *    拿它判断会误报：昨天保存失败过一次，今天打开列表就显示"错误"。
   *    ⭐ **"这次读失败"必须由"这次读"自己报告。**
   *
   * ⭐ 逻辑只有这一处 —— `listPlaces()` 是它的薄封装（别在两处各写一遍）。
   *
   * @returns {{ok: boolean, places: Array, reason: string}}
   */
  function readPlacesResult() {
    /* ⭐ 如果"第一次从云端拉数据"就失败了，如实报错 ——
       ⚠️ 不能让上层看到空数组（那会被显示成「还没有记录」，把用户往错的方向引） */
    if (initError) {
      return { ok: false, places: [], reason: initError };
    }

    if (placesCache !== null) {
      return { ok: true, places: placesCache, reason: '' };   /* 缓存命中 → 一定成功 */
    }

    /* ⭐ Day 20 起：数据源只有云端了。
       ⚠️ 走到了这里说明**页面还没调用 init()** —— 这是代码 bug，不是"没有数据"，
          所以如实报错（而不是去读 localStorage 兜底）——
          ⭐ 否则会出现"看起来正常、其实读的是本地旧数据"的错觉。 */
    return {
      ok: false,
      places: [],
      reason: '数据还没加载（页面启动时应当先调用 TripMemoStore.init()）'
    };
  }

  /** 取全部地点（薄封装 —— 只想拿数据、不关心失败原因时用它） */
  function listPlaces() {
    return readPlacesResult().places;
  }

  /**
   * ⭐ 广播变更事件，并把这次改动**同步到云数据库**（Day 20）
   *
   * ⚠️ 为什么是"先广播、后台同步"（乐观更新）：
   *    原来是同步写 localStorage —— 写完就算成功。现在要发网络请求，
   *    但**不能把界面卡住等服务器**（那点一下要等好几百毫秒）。
   *    ⭐ 所以：**先在本地当它成功了**（界面立刻有反馈），
   *       同时后台发请求；⚠️ **万一服务器拒绝，就回滚本地数据 + 报错**。
   *
   * @param {string} action 'add' | 'update' | 'remove'
   * @param {object} place  刚变动的那条
   * @param {object} [before] ⚠️ 仅 update 需要：改动**之前**的那份（回滚用）
   */
  function persist(action, place, before) {
    broadcastChange(action, place);

    syncToCloud(action, place, before);
  }

  /** 只广播，不发请求（init 时用） */
  function broadcastChange(action, place) {
    /* 通知界面刷新 —— 各视图监听到后自己重画。
       ⚠️ 除了"条数"，还必须告诉外界**发生了什么**（新增/编辑/删除）和**是哪一条**。
          只播报 count 的话，监听者只知道"数据变了"，给不出准确反馈 ——
          那等于把"弹窗关闭"那种歧义（成功和取消分不出）原样搬到了事件层。
       action: 'add' | 'update' | 'remove'
       place:  刚变动的那条地点（删除时 = 被删掉的那条） */
    document.dispatchEvent(new CustomEvent('data:change', {
      detail: {
        count: placesCache.length,
        action: action || 'unknown',
        place: place || null
      }
    }));
  }

  /* ------------------------------------------------------------
     二、增删改查
     ------------------------------------------------------------ */

  /* ------------------------------------------------------------
     ⭐⭐ 照片（Day 21）
     ------------------------------------------------------------
     ⭐ 存哪：CloudBase **云存储**（不是数据库）——
        数据库里 `places.images` 只存**文件的 fileID**（一串 cloud:// 开头的标识）。
     ⭐ 为什么不能存 Base64：一张手机照片变字符串后好几 MB，
        而数据库一条文档上限 16MB —— 几张就爆了。

     ⭐ 流程：压缩 → 上传拿 fileID → 存进 images（调 PATCH）→ 显示时换链接
     ------------------------------------------------------------ */

  /** 照片的最长边（像素）—— ⚠️ 手机原图动辄 4000px，不压根本传不动 */
  var PHOTO_MAX_SIDE = 1600;
  /** JPEG 压缩质量 0~1 —— ⭐ 0.82 是"肉眼看不出、体积小很多"的常用值 */
  var PHOTO_QUALITY = 0.82;

  /**
   * ⭐ 在浏览器里压缩一张图片（纯 canvas，不引任何库）
   *
   * ⚠️ 为什么必须压：手机拍一张 3~5MB，不压的话——
   *    · 上传慢、费流量
   *    · 云存储很快占满
   *    · 页面加载一堆原图会卡
   *
   * @param {File} file
   * @returns {Promise<File>} 压缩后的新文件（⭐ 仍是 File —— 上传接口要这个类型）
   */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);

      img.onload = function () {
        URL.revokeObjectURL(url);

        var w = img.naturalWidth;
        var h = img.naturalHeight;
        var scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(w, h));

        var canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);

        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('压缩失败（canvas.toBlob 返回空）')); return; }
          /* ⚠️ 转成 File 而不是直接用 Blob ——
             上传接口要的是 File 类型，用 Blob 有版本差异风险。 */
          var name = 'photo_' + Date.now() + '.jpg';
          try {
            resolve(new File([blob], name, { type: 'image/jpeg' }));
          } catch (e) {
            /* 个别老浏览器没有 File 构造函数 —— 退回 Blob 试试 */
            resolve(blob);
          }
        }, 'image/jpeg', PHOTO_QUALITY);
      };

      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('这张图片打不开（可能不是图片文件）'));
      };

      img.src = url;
    });
  }

  /**
   * ⭐ 上传一张照片到云存储
   * @param {File} file
   * @param {string} placeId 地点 id —— ⭐ 用它做目录，删地点时好找
   * @returns {Promise<string>} ⭐ fileID（存在数据库里的就是它）
   */
  function uploadPhoto(file, placeId) {
    if (!cbaApp) {
      return Promise.reject(new Error('还没登录，不能上传照片'));
    }
    if (!file || file.type.indexOf('image/') !== 0) {
      return Promise.reject(new Error('只能上传图片文件'));
    }

    return compressImage(file).then(function (compressed) {
      /* ⚠️ cloudPath 规则：只允许字母数字 / ! - _ . 空格 * 和中文，用 / 分层。
         这里按地点分目录，⭐ 将来"删地点时顺手删照片"能找到它们。 */
      var cloudPath = 'places/' + placeId + '/'
        + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.jpg';

      return cbaApp.uploadFile({ cloudPath: cloudPath, filePath: compressed });
    }).then(function (res) {
      if (!res || !res.fileID) throw new Error('上传成功但没拿到 fileID');
      return res.fileID;
    });
  }

  /**
   * ⭐ 把 fileID 换成能放进 <img src> 的链接
   *
   * ⚠️ 为什么不自己拼 URL：官方明确警告过 ——
   *    "不要拼接 envId / 域名 / 路径去造一个看起来像公开的链接，
   *     要用 getTempFileURL() 拿 SDK 解析出来的地址"。
   *
   * ⭐ 云存储默认权限是"所有用户可读" —— 这种情况下拿到的链接**不过期**，
   *    所以路径和显示都很直接。（如果以后改成私有读，这里要处理有效期。）
   *
   * @param {string[]} fileIDs
   * @returns {Promise<Array<{fileID:string, url:string}>>} ⚠️ 失败的那些 url 为空字符串
   */
  function resolvePhotoUrls(fileIDs) {
    var list = (fileIDs || []).filter(function (x) { return !!x; });
    if (!list.length) return Promise.resolve([]);
    if (!cbaApp) return Promise.resolve([]);

    return cbaApp.getTempFileURL({
      fileList: list.map(function (id) { return { fileID: id, maxAge: 3600 }; }),
    }).then(function (res) {
      return ((res && res.fileList) || []).map(function (f) {
        return { fileID: f.fileID, url: f.tempFileURL || f.download_url || '' };
      });
    }).catch(function (err) {
      console.warn('[TripMemo] 换取照片链接失败：', err);
      return [];
    });
  }

  /**
   * ⭐ 从云存储删掉若干文件（Day 22）
   *
   * ⚠️ 为什么失败**不报给用户**：
   *    地点在数据库里**已经删掉了** —— 照片没删干净只是留个孤儿文件，
   *    不该让用户看到"删除失败"这种误导性的提示。
   *    ⭐ 所以这里只 `console.warn` 留个记录，供以后排查/清理。
   *
   * @param {string[]} fileIDs
   */
  function deleteCloudFiles(fileIDs) {
    var list = (fileIDs || []).filter(function (x) { return !!x; });
    if (!list.length || !cbaApp) return;

    cbaApp.deleteFile({ fileList: list }).then(function (res) {
      /* ⚠️ 官方文档提醒：要**逐条检查**返回结果，别假设全成功 */
      var failed = ((res && res.fileList) || []).filter(function (f) {
        return f.code !== 'SUCCESS';
      });
      if (failed.length) {
        console.warn('[TripMemo] 有 ' + failed.length + ' 张照片没删掉'
          + '（不影响地点已删除，但云存储里会留孤儿文件）：', failed);
      } else {
        console.log('[TripMemo] 已清理 ' + list.length + ' 张照片');
      }
    }).catch(function (err) {
      console.warn('[TripMemo] 删云存储文件失败（地点本身已删掉，只是留了孤儿文件）：', err);
    });
  }

  /**
   * ⭐ 扫描一个容器里所有"等着贴照片"的 <img>，批量换成真实链接（Day 21）
   *
   * ⭐ 为什么用这个套路（而不是在画缩略图时各自请求）：
   *    列表一屏可能有十几个地点，**一个一个去换链接就是十几次请求**；
   *    这里先收集再一次性换，只发一次。
   *
   * ⭐ 怎么用：缩略图里放一个 `<img data-photo-id="cloud://...">`（**先不设 src**），
   *    渲染完之后调一次本函数即可。
   * ⚠️ 换不到链接的那些 img 会被**移除** —— 下面那层"色块 + 首字"就露出来了，
   *    正好是"没照片"该有的样子。
   *
   * @param {HTMLElement} root 要扫描的容器
   */
  function attachPhotosTo(root) {
    if (!root || !root.querySelectorAll) return;

    var imgs = Array.prototype.slice.call(root.querySelectorAll('img[data-photo-id]'));
    if (!imgs.length) return;

    /* ⭐ 去重：同一个 fileID 只请求一次（列表里可能重复出现） */
    var ids = [];
    imgs.forEach(function (img) {
      var id = img.getAttribute('data-photo-id');
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
    if (!ids.length) return;

    resolvePhotoUrls(ids).then(function (list) {
      var urlById = {};
      list.forEach(function (item) { urlById[item.fileID] = item.url; });

      imgs.forEach(function (img) {
        var url = urlById[img.getAttribute('data-photo-id')];
        if (url) {
          img.src = url;
        } else if (img.parentNode) {
          /* ⚠️ 没换到 → 移除这个 img，让下面的色块露出来 */
          img.parentNode.removeChild(img);
        }
      });
    }).catch(function (err) {
      console.warn('[TripMemo] 批量换照片链接失败：', err);
      /* ⚠️ 整体失败时把所有占位 img 都撤掉 —— 宁可显示色块，不要留一片碎图 */
      imgs.forEach(function (img) {
        if (img.parentNode) img.parentNode.removeChild(img);
      });
    });
  }

  /**
   * ⭐ 把一次本地改动同步到云数据库（Day 20）
   * ⚠️ 失败时**回滚本地数据** —— 否则界面会显示"实际上没存上"的东西（幽灵数据）。
   */
  function syncToCloud(action, place, before) {
    var promise;

    if (action === 'add') {
      promise = requestJson('POST', '/api/places', place).then(function (r) {
        /* ⚠️ 409 = 云端已经有同坐标了；400 = 参数不合法。
           两种情况都说明"没存上"，必须回滚。 */
        if (r.json && r.json.ok === true) return null;
        throw new Error(errorMessageOf(r));
      });
    } else if (action === 'update') {
      /* ⭐ 这里用 **PATCH**（Day 22 把名字改对了）。
         ⭐ 为什么原来是 PUT：这个接口做的是"部分更新"（只改传了的字段）——
            那正是 PATCH 的语义，叫 PUT 是名字没对上。
         ⚠️ 服务端现在**两个方法都接受**，所以老的 PUT 也不会坏。
         ⚠️ 服务端是部分更新：只改请求体里出现的字段；
            这里传的是合并后的完整对象，也没问题（⭐ 它是"部分更新"的超集）。 */
      promise = requestJson('PATCH', '/api/place?id=' + encodeURIComponent(place.id), place)
        .then(function (r) {
          if (r.json && r.json.ok === true) return null;
          throw new Error(errorMessageOf(r));
        });
    } else if (action === 'remove') {
      /* ⭐ Day 22：删除接口做好了（DELETE /api/place?id=）。
         ⭐ 云端删成功之后，**顺手把这条地点的照片也从云存储删掉** ——
            ⚠️ 不删的话文件会永远留在云存储里，成为"孤儿文件"（白占额度、还删不掉）。
         服务端返回里带上了被删的那条，正好用它拿 `images`。 */
      promise = requestJson('DELETE', '/api/place?id=' + encodeURIComponent(place.id))
        .then(function (r) {
          if (!r.json || r.json.ok !== true) {
            throw new Error(errorMessageOf(r));
          }
          var imgs = (r.json.place && r.json.place.images)
            || (place && place.images)
            || [];
          deleteCloudFiles(imgs);
          return null;
        });
    } else {
      return;
    }

    promise.catch(function (err) {
      rollback(action, place, before);
      reportError('同步到云端', err);
    });
  }

  /**
   * ⭐ 把一次失败的改动撤销掉（把本地数据恢复成改动前的样子）
   *
   * ⚠️⚠️ 注意：这里广播的 action 是 **'rollback'**，不是 add / remove / update（Day 23 改）
   *
   * ⭐ 为什么必须换掉原来的写法（原来"撤销新增"发的是 'remove'、"撤销删除"发的是 'add'）：
   *    `main.js` 的 `showDataChangeAlert` 监听 `data:change`，
   *    它把 'remove' 理解成"用户删掉了一条" → 会弹「**已删除：xxx**」。
   *    ⚠️ 可那时候**什么都没删**，只是回滚 —— 这句话是**假的**，
   *       用户会以为自己的数据被删了（**比不提示更糟**）。
   *    （这个坑原来一直没暴露，是因为"错误提示永久挂着"把它盖住了 ——
   *      Day 23 修好提示条之后它才露出来。）
   *
   * ⭐ 换成 'rollback' 之后各方反应：
   *    · 时间轴 / 地点列表：`addEventListener('data:change', render)` → **任何 action 都会重绘** ✅
   *    · 地图：`action === 'add' ? 编排 : refresh()` → 非 add 走 refresh ✅
   *    · 提示逻辑：只认 add / update / remove 三个值 → **自然被忽略** ✅
   */
  function rollback(action, place, before) {
    var list = listPlaces();
    if (action === 'add') {
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === place.id) { list.splice(i, 1); break; }
      }
      broadcastChange('rollback', place);
    } else if (action === 'remove') {
      list.push(place);
      broadcastChange('rollback', place);
    } else if (action === 'update' && before) {
      for (var j = 0; j < list.length; j++) {
        if (list[j].id === place.id) { list[j] = before; break; }
      }
      broadcastChange('rollback', before);
    }
  }

  /**
   * ⭐ 第一次从云端拉数据（Day 20）
   * ⚠️ 页面启动时必须先 await 它，再渲染 —— 否则列表里什么都还没有。
   * @returns {Promise<boolean>} 成功 true
   */
  function init() {
    initError = null;

    /* ⭐ 第一步永远是"先有身份" —— 否则请求会被当成匿名/别人 */
    return initAuth().then(function () {
      return requestJson('GET', '/api/places');
    }).then(function (r) {
      if (!r.json || r.json.ok !== true || !Array.isArray(r.json.places)) {
        throw new Error(errorMessageOf(r));
      }
      placesCache = r.json.places;

      return requestJson('GET', '/api/meta');
    }).then(function (r) {
      if (r.json && r.json.ok === true) {
        settingsCache = {
          mainCity: r.json.mainCity || null,
          sampleLoaded: !!r.json.sampleLoaded
        };
      } else {
        /* ⚠️ 设置拉不到不算致命 —— 地点数据才是主角，先让它显示出来 */
        settingsCache = { mainCity: null, sampleLoaded: false };
        console.warn('[TripMemo] 读设置失败，先按默认值继续：', r);
      }

      broadcastChange('init', null);
      document.dispatchEvent(new CustomEvent('settings:change', {
        detail: { mainCity: getMainCity() }
      }));

      /* ⭐ 临时自检（Day 20 实测用）：把"云函数看到的身份"打到 Console。
         ⚠️ 为什么要它：token 存在这个函数的闭包里，在 Console 里手动取不到 ——
            所以让页面自己问一次、自己打出来。
         ⭐ 确认身份解析通了之后，这两行可以删掉。 */
      requestJson('GET', '/api/whoami').then(function (w) {
        /* ⭐ 存到全局，方便在 Console 里随时查看（输入 __tripmemoWhoami 回车） */
        global.__tripmemoWhoami = w.json;
        /* ⚠️ 用 JSON.stringify 打成**一行文字** ——
           直接打印对象的话，Console 里只显示一个可折叠的 `▶ Object`，
           还得手点才看得见内容，很不方便。 */
        console.log('[TripMemo] 身份自检 → ' + JSON.stringify(w.json));
      });

      return true;
    }).catch(function (err) {
      /* ⭐ 记成"加载失败"，让界面显示错误态（而不是伪装成"还没有记录"） */
      initError = '读不到云端数据：' + ((err && err.message) ? err.message : String(err));
      placesCache = [];
      reportError('从云端加载', err);
      return false;
    });
  }

  /** 取单条 */
  function getPlace(id) {
    var list = listPlaces();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        return list[i];
      }
    }
    return null;
  }

  /**
   * 新增一条
   * @param {Object} input 表单输入
   * @returns {{ok: boolean, missing?: string[], place?: Object}}
   */
  function addPlace(input) {
    var check = Model.validate(input);
    if (!check.ok) {
      return { ok: false, missing: check.missing };
    }
    var place = Model.createPlace(input);
    listPlaces().push(place);
    persist('add', place);
    return { ok: true, place: place };
  }

  /**
   * 修改一条（按 id 覆盖）
   * @returns {{ok: boolean, missing?: string[]}}
   */
  function updatePlace(id, input) {
    var check = Model.validate(input);
    if (!check.ok) {
      return { ok: false, missing: check.missing };
    }
    var list = listPlaces();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
          var before = list[i];   /* ⭐ 留一份改动前的，万一云端拒绝要回滚 */
          var merged = Model.createPlace(Object.assign({}, before, input, { id: id }));
          list[i] = merged;
          persist('update', merged, before);
        return { ok: true, place: merged };
      }
    }
    return { ok: false, missing: ['该地点不存在'] };
  }

  /** 删除一条 */
  function removePlace(id) {
    var list = listPlaces();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          /* ⚠️ 必须先把它取出来再 splice —— 删掉之后就问不出"是哪条"了 */
          var removed = list[i];
          list.splice(i, 1);
          persist('remove', removed);
          return true;
        }
    }
    return false;
  }

  /** 按类型过滤（PRD 4.1 #2 的筛选栏）；type 为空表示"全部" */
  function filterByType(type) {
    var list = listPlaces();
    if (!type) {
      return list;
    }
    return list.filter(function (place) {
      return place.type === type;
    });
  }

  /* ------------------------------------------------------------
     三、全局设置：主城市（PRD 4.1 #8）
     只存一个城市名 + 它的中心坐标。
     存坐标的原因：主城市可能一个地点都还没有，
                这时候画"灰色锚点"需要知道它在哪。
     ------------------------------------------------------------ */

  function readSettings() {
    if (settingsCache !== null) {
      return settingsCache;
    }
    /* ⭐ Day 20 起：设置也来自云端（init() 里拉的 /api/meta）。
       ⚠️ 走到这里 = 还没 init()，或 init 时没拉到设置 —— 返回空设置（不算致命错误）。 */
    settingsCache = {};
    return settingsCache;
  }

  /**
   * ⭐ 把设置同步到云端（Day 23 实装）
   *
   * ⚠️⚠️ 这里以前是**空的** —— 只广播一个事件、什么都没保存。
   *    注释写的是"等 PUT /api/meta 做好再补"，结果一直没补。
   *    ⭐ 而且**实际后果比注释写的更严重**：
   *       注释说"换设备会丢"，其实连 localStorage 都没有 → **刷新一下就丢**。
   *    ⭐ 地图上**所有连线都从主城市出发** → ⭐ **一刷新，连线全没了**。
   *
   * ⭐ 做法和地点一样：**先广播、后台同步**（乐观更新）——
   *    界面立刻有反馈，不必等服务器。
   * ⚠️ 失败时**不回滚**（设置只有一个值，回滚反而容易错乱）：
   *    改为**如实报错**，让顶部提示条说清"可能没保存"。
   */
  function persistSettings() {
    /* ① 先广播 —— 界面立刻重画（切主城市要马上看见锚点和线跟着动） */
    document.dispatchEvent(new CustomEvent('settings:change', {
      detail: { mainCity: getMainCity() }
    }));

    /* ② 再后台写云端 */
    var settings = readSettings();
    requestJson('PUT', '/api/meta', {
      mainCity: settings.mainCity || null,
      sampleLoaded: !!settings.sampleLoaded
    }).then(function (r) {
      /* ⚠️ 这里必须 `throw`，不能 `return` ——
         `return new Error(...)` **不会**触发下面的 catch（今天刚在 syncToCloud 上修掉这个坑）。 */
      if (!r.json || r.json.ok !== true) {
        throw new Error(errorMessageOf(r));
      }
      /* ⭐ 用服务端返回的值回填 —— 以服务端为准（它可能做了规整） */
      settingsCache.mainCity = r.json.mainCity || null;
      settingsCache.sampleLoaded = !!r.json.sampleLoaded;
    }).catch(function (err) {
      reportError('保存设置', err);
    });
  }

  /**
   * 取主城市
   * @returns {{city: string, lng: number, lat: number}|null}
   */
  function getMainCity() {
    return readSettings().mainCity || null;
  }

  /**
   * 设置主城市；传 null 表示清除（清除后地图上不画任何连线）
   * @param {{city: string, lng: number, lat: number}|null} value
   */
  function setMainCity(value) {
    var settings = readSettings();
    settings.mainCity = value || null;
    persistSettings();
  }

  /* ------------------------------------------------------------
     四、导出 JSON（PRD 4.1 #7 / 验收标准 14）
     这是"数据不绑架"的底线：localStorage 一清就全没，
     导出是唯一的保险绳。
     ------------------------------------------------------------ */

  /**
   * 生成导出用的 JSON 文本
   * 注意：连主城市一起导出 —— 否则导入回来会丢掉锚点设置
   * @returns {string}
   */
  function exportJSON() {
    var payload = {
      app: 'TripMemo',
      exportedAt: new Date().toISOString(),
      count: listPlaces().length,
      mainCity: getMainCity(),
      places: listPlaces()
    };
    return JSON.stringify(payload, null, 2);
  }

  /** 触发浏览器下载 */
  function downloadJSON() {
    var text = exportJSON();
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var stamp = new Date().toISOString().slice(0, 10);

    var a = document.createElement('a');
    a.href = url;
    a.download = 'tripmemo-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 导入一份之前导出的 JSON（**整体替换**当前数据）
   *
   * ⭐ 为什么必须补它（Day 11 重做）：
   *    原来只有导出、没有导入 —— 导出的文件等于死在硬盘上，回不来。
   *    而 TECH_DESIGN 里写着「数据全丢（PRD 已用导出 JSON 兜底）」——
   *    **只有出口没有入口，那句话是兜不住底的**。补上这一半，它才真的成立。
   *    （上面 exportJSON 的注释其实早就写了"否则导入回来会丢掉锚点设置"，
   *      说明当初就想到了导入，只是一直没做。）
   *
   * ⚠️ 语义是**替换**，不是追加 —— 和导出对称（导出的是完整快照）。
   *    所以调用方**必须先让用户确认**，它会覆盖现有数据。
   * ⚠️ 校验 app 标记：随手选个别的 JSON 不会把现有地点冲掉。
   *
   * @param {string|Object} raw 文件内容（字符串）或已解析的对象
   * @returns {{ok: boolean, count?: number, reason?: string}}
   */
  function importJSON(raw) {
    var data = raw;
    if (typeof raw === 'string') {
      try {
        data = JSON.parse(raw);
      } catch (err) {
        return { ok: false, reason: '不是合法的 JSON 文件' };
      }
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, reason: '文件内容不是一个对象' };
    }
    /* ⚠️ 先认"是不是我们导出的"（exportJSON 里写了 app: 'TripMemo'）。
       不校验的话，随手选个别的 JSON 也会把现有地点清空。 */
    if (data.app !== 'TripMemo') {
      return { ok: false, reason: '不是 TripMemo 导出的文件（缺少 app 标记）' };
    }
    if (!Array.isArray(data.places)) {
      return { ok: false, reason: '文件里没有 places 列表' };
    }

    /* 走 replaceAllPlaces → 内部会过一遍 Model.createPlace 规范化，
       所以旧版本导出的、字段不全的数据也能安全读进来 */
    replaceAllPlaces(data.places);

    /* 主城市也一起恢复。⚠️ 老文件可能没这个字段 → 保持现状，不算失败 */
    if (data.mainCity && data.mainCity.city) {
      setMainCity(data.mainCity);
    }

    return { ok: true, count: data.places.length };
  }

  /* ------------------------------------------------------------
     五、示例数据（Day 8）

     ⚠️⚠️ **Day 23：UI 入口已移除** —— 左侧那个「载入示例数据」按钮删掉了。
         ⭐ 原因：它是**开发和演示用的工具**，不该出现在"给所有人用"的站点上 ——
            访客点一下界面就会被 13 条**假地点**填满，而他不知道那是假的。
         ⭐ 但**这一层保留**（没有删代码）：
            · 将来做演示 / 自测时，Console 里调一下就能用：
                TripMemoStore.loadSampleData()     ← 载入
                TripMemoStore.clearSampleData()    ← 还原
            · 也因为下面的 `replaceAllPlaces()` 是**导入 JSON 共用的**，不能删。
         ⚠️ 代价（要诚实记住）：这几个函数现在**没有任何 UI 调用方** ——
            如果将来确认永远不再需要，可以整段删除（连带 `KEY_BACKUP`）。

     为什么要它：项目原本是空的，必须手动录 5 分钟才看得到界面。
                有了它，一载入就能看到完整效果，也方便以后改代码时自测。

     设计要点：
       · **整体替换**，不是"追加" —— 追加会把示例和你自己的数据混在一起，
         想撤销就撤不干净；整体替换 + 备份，一键能回到原样。
       · **载入前先备份**原数据到 KEY_BACKUP，清空时原样恢复。
       · **只在没有备份时才备份** —— 防止连点两次把备份覆盖成示例数据。
       · 是否处于"示例模式"记在 settings.sampleLoaded 上，重启浏览器也不丢。
     ------------------------------------------------------------ */

  /** 当前是不是加载了示例数据 */
  function isSampleLoaded() {
    return readSettings().sampleLoaded === true;
  }

  /**
   * 把一批地点**整体替换**进存储
   * 走 Model.createPlace 规范化，保证和表单录入出来的结构完全一致
   * @param {Array} places 原始数据（可以是 mock-data.js 里那种"只填了部分字段"的）
   */
  function replaceAllPlaces(places) {
    placesCache = (places || []).map(function (item) {
      return Model.createPlace(item);
    });
    /* ⚠️⚠️ 已知缺口（Day 20）：这里**只改本地，不会同步到云端**。
       原因：批量写入的接口（POST /api/places/bulk）还没做。
       ⭐ 后果：「导入 JSON」和「装示例数据」这两个功能**页面上看起来有效，
          但刷新一下就没了**（因为刷新会从云端重新拉）。
       ⚠️ 等批量接口做了之后，这里补一次 requestJson('POST', '/api/places/bulk', ...)。 */
    persist();
  }

  /**
   * 载入示例数据
   * @returns {{ok: boolean, count?: number, reason?: string}}
   */
  function loadSampleData() {
    var Mock = global.TripMemoMock;
    if (!Mock || !Array.isArray(Mock.places)) {
      return { ok: false, reason: '示例数据文件没加载成功（js/mock-data.js）' };
    }
    if (isSampleLoaded()) {
      return { ok: false, reason: '示例数据已经在用了' };
    }

    /* 1、先把当前数据备份起来（已经有备份就不覆盖） */
    try {
      if (global.localStorage.getItem(KEY_BACKUP) === null) {
        global.localStorage.setItem(KEY_BACKUP, JSON.stringify({
          places: listPlaces(),
          settings: readSettings(),
          savedAt: new Date().toISOString()
        }));
      }
    } catch (err) {
      reportError('备份原有数据', err);
      return { ok: false, reason: '无法备份现有数据，为安全起见没有载入' };
    }

    /* 2、写入示例地点 */
    replaceAllPlaces(Mock.places);

    /* 3、设好主城市，这样一载入就能看到连线 */
    var settings = readSettings();
    settings.mainCity = Mock.mainCity;
    settings.sampleLoaded = true;
    persistSettings();

    console.log('[TripMemo] 已载入示例数据：' + placesCache.length + ' 个地点');
    return { ok: true, count: placesCache.length };
  }

  /**
   * 清空示例数据，恢复载入前的原数据
   * @returns {{ok: boolean, count?: number}}
   */
  function clearSampleData() {
    var raw = null;
    try {
      raw = global.localStorage.getItem(KEY_BACKUP);
    } catch (err) {
      reportError('读取备份', err);
    }

    if (raw) {
      /* 有备份 → 原样恢复 */
      try {
        var backup = JSON.parse(raw);
        placesCache = Array.isArray(backup.places) ? backup.places : [];
        settingsCache = (backup.settings && typeof backup.settings === 'object')
          ? backup.settings
          : {};
        /* 恢复出来的设置里不该带示例标记 */
        delete settingsCache.sampleLoaded;
        persist();
        persistSettings();
      } catch (err) {
        reportError('恢复备份', err);
        placesCache = [];
        settingsCache = {};
        persist();
        persistSettings();
      }
    } else {
      /* 没备份（比如载入示例后手动清了浏览器数据）→ 退化成清空 */
      placesCache = [];
      settingsCache = {};
      persist();
      persistSettings();
    }

    /* 备份用完就删 —— 留着会让下次载入示例时不重新备份 */
    try {
      global.localStorage.removeItem(KEY_BACKUP);
    } catch (err) {
      reportError('删除备份', err);
    }

    console.log('[TripMemo] 已清空示例数据，恢复原有数据：' + (placesCache ? placesCache.length : 0) + ' 个地点');
    return { ok: true, count: placesCache ? placesCache.length : 0 };
  }

  /* ------------------------------------------------------------
     六、对外暴露
     ------------------------------------------------------------ */
  global.TripMemoStore = {
    listPlaces: listPlaces,
    init: init,                           /* ⭐ Day 20：页面启动时先从云端拉一次数据 */
    getAuthError: function () { return authError; },   /* ⭐ 登录失败时给界面显示用 */
    /* ⭐ Day 21：照片相关 */
    uploadPhoto: uploadPhoto,
    resolvePhotoUrls: resolvePhotoUrls,
    attachPhotosTo: attachPhotosTo,
    readPlacesResult: readPlacesResult,   /* Day 13：能如实报告"这次读失败"，给视图的四种状态用 */
    getPlace: getPlace,
    addPlace: addPlace,
    updatePlace: updatePlace,
    removePlace: removePlace,
    filterByType: filterByType,
    getMainCity: getMainCity,
    setMainCity: setMainCity,
    exportJSON: exportJSON,
    downloadJSON: downloadJSON,
    importJSON: importJSON,     /* Day 11 重做：给「导出」补上回程 */
    /* Day 8 新增 */
    isSampleLoaded: isSampleLoaded,
    loadSampleData: loadSampleData,
    clearSampleData: clearSampleData,
    getLastError: function () { return lastError; }
  };

}(window));
