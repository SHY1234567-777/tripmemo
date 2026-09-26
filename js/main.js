/* ============================================================
   TripMemo 入口脚本
   Day 7 · 步骤 2a：页面骨架 —— 导航栏与视图切换
   Day 8 · 板块③：接上「示例数据」按钮与全局错误提示

   本文件只负责「装配」：把按钮、视图、数据层接起来，不写业务逻辑。
   ============================================================ */

(function () {
  'use strict';

  /* 视图名 → 容器 id 的对应关系
     ⚠️ Day 11 新增 `landing`（门面页）—— 它**不在导航栏里**，
        所以没有对应的 `.nav-btn[data-view]`；switchView 里那段
        "同步导航高亮" 对它天然是个空操作（全部取消高亮），不用特判。 */
  var VIEW_IDS = {
    landing: 'view-landing',
    map: 'view-map',
    timeline: 'view-timeline',
    places: 'view-places'
  };

  /* 默认首屏：**门面页**（Day 11 改，原来写的是 'map'）
     ⚠️ 这和 PRD 5.1「地图视图（默认首屏）」目前是**不一致**的 ——
        按他要求先做的原型；PRD / TECH_DESIGN 等他确定要留下门面页再补。 */
  var DEFAULT_VIEW = 'landing';

  /* 地图有没有初始化过（Day 11：地图改成"进地图时才初始化"，见 ensureMapInited） */
  var mapInited = false;

  /* 当前正在显示的视图名 */
  var currentView = DEFAULT_VIEW;

  /* 示例数据按钮的两个文案 */
  var SAMPLE_LABEL_LOAD = '载入示例数据';
  var SAMPLE_LABEL_CLEAR = '清空示例数据';

  /**
   * 切换视图
   * @param {string} name 视图名（map / timeline / places）
   */
  /**
   * 确保地图已经初始化（Day 11 新增）
   *
   * ⚠️ 为什么改成"进地图时才初始化"，而不是页面一加载就初始化：
   *   ① **门面页显示时 `#view-map` 是 `display: none`** —— 容器尺寸是 0×0，
   *      高德在这种容器里建地图会算错视野。
   *   ② 门面页就一屏字，**没必要先把高德那一大坨 SDK 下下来**再让访客点进来。
   *
   * 只在第一次进地图时跑一次；后面再切回来什么都不做
   * （尺寸变化由 map.js 里监听 `view:change` 的 `resizeMap()` 负责）。
   */
  function ensureMapInited() {
    if (mapInited || !window.TripMemoMap) {
      return;
    }
    mapInited = true;
    console.log('[TripMemo] 首次进入地图视图，开始初始化地图');
    window.TripMemoMap.init();
  }

  function switchView(name) {
    if (!VIEW_IDS[name]) {
      return;
    }
    currentView = name;

    /* 门面页是"没有导航"的一屏：进去时把导航栏整个藏起来。
       靠 body 上的类控制，CSS 里就一句 `body.is-landing .app-nav { display: none }`。
       为什么要藏：门面就该是**整屏一屏**，露出一排功能菜单就不像门面了 ——
       参考的那个站（html5up.net/dimension）也是整屏无导航。 */
    document.body.classList.toggle('is-landing', name === 'landing');

    // 1、视图容器：只让目标视图显示
    Object.keys(VIEW_IDS).forEach(function (key) {
      var el = document.getElementById(VIEW_IDS[key]);
      if (el) {
        el.classList.toggle('is-active', key === name);
      }
    });

    // 2、导航按钮：同步高亮状态
    document.querySelectorAll('.nav-btn[data-view]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.view === name);
    });

    /* 3、如果目标就是地图，这时候才去初始化它。
       ⚠️ 顺序有讲究：必须**排在广播 view:change 之前** ——
          上面第 1 步刚把地图视图切为可见，此时容器才有真实尺寸，
          高德才能算对视野（map.js 在 init 末尾也会自己 resize 一次）。 */
    if (name === 'map') {
      ensureMapInited();
    }

    // 4、广播事件：地图需要知道「自己被显示了」才能正确计算尺寸
    document.dispatchEvent(new CustomEvent('view:change', {
      detail: { view: name }
    }));
  }

  /**
   * 「导出 JSON」按钮
   * 数据层提供导出能力，这里只负责接线（PRD 4.1 #7）
   */
  function handleExportClick() {
    var Store = window.TripMemoStore;
    if (!Store) {
      window.alert('数据层尚未就绪，暂时无法导出。');
      return;
    }
    var count = Store.listPlaces().length;
    if (count === 0) {
      window.alert('现在还没有任何地点，导出的文件会是空的。');
      return;
    }
    Store.downloadJSON();
    console.log('[TripMemo] 已导出 ' + count + ' 个地点');
  }

  /* ------------------------------------------------------------
     示例数据按钮（Day 8）

     一个按钮两种作用，靠数据层记录的 sampleLoaded 判断该做哪个。
     为什么要弹确认框：载入会"换掉"当前数据，虽然是可还原的，
                      但用户必须知道发生了什么，不能默默替换。
     ------------------------------------------------------------ */

  /** 按当前状态刷新按钮文案 */
  function refreshSampleLabel() {
    var label = document.getElementById('btn-sample-label');
    var Store = window.TripMemoStore;
    if (!label || !Store || !Store.isSampleLoaded) {
      return;
    }
    label.textContent = Store.isSampleLoaded() ? SAMPLE_LABEL_CLEAR : SAMPLE_LABEL_LOAD;
  }

  /** 点示例数据按钮 */
  function handleSampleClick() {
    var Store = window.TripMemoStore;
    if (!Store || !Store.loadSampleData) {
      window.alert('数据层尚未就绪，暂时无法操作示例数据。');
      return;
    }

    if (Store.isSampleLoaded()) {
      /* 当前是示例模式 → 清空并还原 */
      var okClear = window.confirm(
        '将清空示例数据，恢复你载入示例前原有的数据。\n\n继续吗？'
      );
      if (!okClear) {
        return;
      }
      var cleared = Store.clearSampleData();
      if (cleared.ok) {
        refreshSampleLabel();
        window.alert('已清空示例数据，恢复原有数据（' + cleared.count + ' 个地点）。');
      }
      return;
    }

    /* 当前是正常模式 → 载入示例 */
    var okLoad = window.confirm(
      '载入示例数据会把当前的地点替换成 13 条示例地点。\n\n'
      + '你现有的数据会先自动备份 —— 随时点「清空示例数据」就能还原。\n\n继续吗？'
    );
    if (!okLoad) {
      return;
    }
    var result = Store.loadSampleData();
    if (result.ok) {
      refreshSampleLabel();
      window.alert('已载入 ' + result.count + ' 条示例地点。\n'
        + '可以去「时间轴」「地点列表」看看效果。');
    } else {
      window.alert('载入失败：' + result.reason);
    }
  }

  /* ------------------------------------------------------------
     全局错误提示（Day 8）

     为什么需要：数据层出错原来只写 console.error，用户看到的是一片空白，
                完全不知道发生了什么 —— 这就是"错误状态最容易被忽略"
                在真实项目里的样子。
     ------------------------------------------------------------ */

  /* ---------- 顶部提示条的两种形态（Day 11 重做）----------
     · 成功态（.app-alert--ok，绿）：告知"操作生效了"，**3 秒后自动消失**
     · 错误态（默认，暖橙）：告知"没保存成功"，**不自动消失**

     为什么一个自动消失、一个不消失：
       成功是**预期内的结果**，看一眼就够，不该赖在屏幕上；
       错误是**需要用户知道的事**（可能丢数据），它不走才是对的。
     ------------------------------------------------------------ */

  var ALERT_OK_HIDE_MS = 3000;
  var alertTimer = null;
  var alertKind = null;   /* 当前挂着的那条是 'ok' 还是 'error' */

  /**
   * 从 CSS 变量读一个毫秒时长
   * ⭐ 为什么要绕这一下：动画时长在 CSS 里（--duration-normal）。
   *    如果在 JS 里再写一个 180，就有了**两个来源** ——
   *    以后改 CSS 忘了改 JS，就会出现"淡出还没播完就被隐藏"这类怪事。
   *    这正是 DESIGN.md 原则 2（一个值只定义一次）要防的。
   */
  function cssDurationMs(name, fallback) {
    try {
      var raw = getComputedStyle(document.documentElement).getPropertyValue(name);
      var n = parseFloat(raw);
      return isNaN(n) ? fallback : n;
    } catch (err) {
      return fallback;
    }
  }

  /**
   * 显示顶部提示条
   * @param {string} text 要说的话
   * @param {string} kind 'ok' = 成功 ｜ 其他值 = 错误样式
   */
  function showAlert(text, kind) {
    var bar = document.getElementById('app-alert');
    if (!bar) {
      return;
    }
    /* ⚠️ 错误优先：已经挂着一条错误时，成功提示**不覆盖它**。
       错误在说"你的改动可能没保存"，成功在说"刚才这步成了" ——
       后者盖掉前者，会让用户误以为数据没事。
       （现实里 store:error 只在本地存储读写出问题时才发，很少见。
         真嫌它碍事，可以给错误条加个「关闭」按钮 —— 那是另一件事。） */
    if (alertKind === 'error' && kind !== 'error') {
      return;
    }

    var isOk = (kind === 'ok');
    /* 它**之前是不是藏着的** —— 决定要不要重播一次淡入。
       连续保存时（条子本来就在屏幕上）只换文字、**不重播动画**，
       否则每存一次就重新淡入一下，看着像在闪。 */
    var wasHidden = bar.hasAttribute('hidden');

    /* 上一条的自动消失计时还没到就又来一条 → 先取消，
       否则新提示会被旧计时器提前关掉（连续操作时必踩） */
    if (alertTimer) {
      clearTimeout(alertTimer);
      alertTimer = null;
    }

    alertKind = kind;
    bar.textContent = text;
    /* ⚠️ 用 classList 只切「成功态」这一个类，**不重置整个 className** ——
       重置会把 is-in 一起抹掉，连续操作时就会闪一下。 */
    bar.classList.toggle('app-alert--ok', isOk);
    bar.removeAttribute('hidden');

    if (!isOk) {
      /* 错误态没有出现动画 —— 它需要立刻被看到 */
      bar.classList.remove('is-in');
      return;
    }

    /* ⚠️ 这一行不能省：先让浏览器按**起始态**（透明 + 上移 8px）算一遍样式。
       否则起始态和结束态会在同一帧里被合并 → transition 根本不播，
       结果还是"一下子出现"。读一下 offsetWidth 就会强制一次重排，
       这是触发 CSS transition 的标准做法。 */
    if (wasHidden) {
      void bar.offsetWidth;
    }
    bar.classList.add('is-in');

    var fadeMs = cssDurationMs('--duration-normal', 180);
    alertTimer = setTimeout(function () {
      /* 先开始淡出…… */
      bar.classList.remove('is-in');
      alertTimer = setTimeout(function () {
        /* ……等淡出播完再真正隐藏，否则会"淡到一半突然没了" */
        bar.setAttribute('hidden', '');
        alertKind = null;
        alertTimer = null;
      }, fadeMs);
    }, ALERT_OK_HIDE_MS);
  }

  /**
   * 数据变了 → 弹一条提示，告诉用户"刚才那个操作生效了"
   *
   * ⚠️ 这正是今天要补的缺口：保存成功原来只写了 console.log（用户看不见），
   *    而"弹窗关闭"不算反馈 —— **取消也会关窗，两者长得一模一样**。
   * ⚠️ 只认 add / update / remove 三种 action：
   *    批量替换、恢复备份那种整体操作发的是 'unknown' —— **故意忽略**，
   *    因为它们不是"某一条地点"的增删改，不该冒充成保存成功。
   */
  function showDataChangeAlert(e) {
    var info = (e && e.detail) || {};
    var place = info.place;
    if (!place || !place.name) {
      return;
    }
    if (info.action === 'add') {
      showAlert('已添加：' + place.name, 'ok');
    } else if (info.action === 'update') {
      showAlert('已保存：' + place.name, 'ok');
    } else if (info.action === 'remove') {
      showAlert('已删除：' + place.name, 'ok');
    }
  }

  /** 把错误显示成页面顶部的一条提示 */
  function showStoreError(detail) {
    /* ⚠️ 两条来路的入参形状不同，必须兼容（2026-09-25 修）：
       ① 事件监听 `addEventListener('store:error', showStoreError)`
          → 传进来的是 **Event 对象**，真正的载荷挂在 `event.detail` 上；
       ② `initGlobalErrorWatch()` 的"开局检查"
          → 直接传 **lastError 裸对象**（{scope, message}）。
       以前只按 ② 的形状解析，于是走 ① 那条路时 info.scope / info.message 全是 undefined
       —— 提示条固定显示「未知环节 / 原因不明」，**真实原因全丢了**。
       这跟今天是同一类毛病：条子挂在那儿，却说不清发生了什么。 */
    var info = (detail && detail.detail) ? detail.detail : (detail || {});
    showAlert('数据出错了（' + (info.scope || '未知环节') + '）：'
      + (info.message || '原因不明') + '　—— 你的改动可能没有被保存。', 'error');
  }

  /**
   * 补一次"开局检查"
   * 因为 store:error 的监听是在 init 里才装的，
   * 万一错误发生得更早，事件已经过去了 —— 这里把记下来的错误补显示一次。
   */
  function initGlobalErrorWatch() {
    var Store = window.TripMemoStore;
    if (Store && Store.getLastError) {
      var err = Store.getLastError();
      if (err) {
        showStoreError(err);
      }
    }
  }

  /** 页面初始化 */
  function init() {
    // 导航按钮 → 切换视图
    document.querySelectorAll('.nav-btn[data-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchView(btn.dataset.view);
      });
    });

    // 导出按钮
    var exportBtn = document.getElementById('btn-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', handleExportClick);
    }

    /* ---- 示例数据按钮（Day 8）----
       ⚠️ 错误提示的监听必须**尽早注册**：数据层出错时会广播
          `store:error`，如果监听装晚了，早期错误就漏掉了。
          所以这里紧跟导出按钮，先于各视图的初始化。 */
    var sampleBtn = document.getElementById('btn-sample');
    if (sampleBtn) {
      sampleBtn.addEventListener('click', handleSampleClick);
    }
    document.addEventListener('store:error', showStoreError);
    /* 数据变更 → 成功提示（Day 11 重做）。和上面一样，尽早注册。 */
    document.addEventListener('data:change', showDataChangeAlert);
    initGlobalErrorWatch();

    /* 门面页的「开始记录」按钮 → 进地图视图
       ⚠️ 用 switchView 而不是给个 <a href>：这是单页应用，
          没有第二个 URL，切视图才是"进门"的正确做法。 */
    var landingBtn = document.getElementById('landing-enter');
    if (landingBtn) {
      landingBtn.addEventListener('click', function () {
        switchView('map');
      });
    }

    // 显示默认视图（Day 11 起是门面页）
    switchView(DEFAULT_VIEW);

    // 初始化地点详情弹窗（三态）
    if (window.TripMemoDetail) {
      window.TripMemoDetail.init();
    }

    // 初始化地点详情抽屉（只读 · Day 10 新增）
    // ⚠️ 必须排在地点列表之前 —— 列表里点条目要用到它
    if (window.TripMemoDrawer) {
      window.TripMemoDrawer.init();
    }

    /* ⚠️ 地图**不再在这里初始化**（Day 11 改）：
       门面页显示时 #view-map 是 display:none，容器 0×0，高德会算错视野；
       而且门面页没必要先把高德 SDK 下下来。
       现在改成"第一次切到地图视图时才初始化"，见 ensureMapInited()。 */

    // 初始化另外两个视图
    if (window.TripMemoTimeline) {
      window.TripMemoTimeline.init();
    }
    if (window.TripMemoPlaces) {
      window.TripMemoPlaces.init();
    }

    // 按钮文案要和当前状态一致（刷新后不能显示错的那个词）
    refreshSampleLabel();

    console.log('[TripMemo] 骨架已就绪，当前视图：' + currentView);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
