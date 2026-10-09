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

  /* ⭐ Day 23 移除：「示例数据按钮」的两个文案常量 —— 跟着按钮一起删了。
     详见下面「示例数据按钮」那一段（现在只剩说明注释）。 */

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

  /**
   * 把当前视图反映到地址栏的 hash 上（Day 13）
   *
   * ⭐ 三条规矩 —— 都是"不这么做就会出 bug"的形状，别自作聪明改：
   *   ① **门面页不写 hash**：它是"没有视图"的那一屏，URL 该是干净的；
   *   ② **hash 已经对了就什么都不做**：否则每切一次都堆一条历史记录；
   *   ③ ⚠️ **由 hashchange 引起的切换，绝不再写 hash** ——
   *      否则「后退 → 触发切换 → 又写一条历史」→ **后退键永远退不完**（经典 bug）。
   *
   * ⚠️ 用 `history.pushState` 而**不是** `location.hash = ...`：
   *    前者**不会触发 `hashchange`**，所以天然没有"自己触发自己"的循环。
   * ⚠️ `pushState` 在 `file://` 下会抛异常（浏览器安全限制）——
   *    所以必须包住：**视图切换本身绝不该因为"地址栏同步失败"而整个坏掉**。
   */
  function syncHash(name, fromHash) {
    if (fromHash) {
      return;                                  /* 规矩 ③ */
    }
    var want = (name === DEFAULT_VIEW) ? '' : ('#' + name);
    if (location.hash === want) {
      return;                                  /* 规矩 ② */
    }
    try {
      history.pushState(null, '', want || (location.pathname + location.search));
    } catch (err) {
      console.warn('[TripMemo] 地址栏同步失败（在 file:// 下打开会这样），视图本身不受影响：', err);
    }
  }

  /**
   * 从地址栏 hash 读出"该显示哪个视图"（Day 13）
   * 认不出来就回默认视图 —— **不发散，永远给一个能用的答案**
   */
  function readHashView() {
    var key = location.hash.replace(/^#/, '');
    if (!key) {
      return DEFAULT_VIEW;                     /* 没有 hash → 门面页 */
    }
    return VIEW_IDS[key] ? key : DEFAULT_VIEW;  /* 未知 hash → 也回门面页 */
  }

  /**
   * 切换视图（唯一的入口 —— 导航、门面页按钮、地址栏、后退键，全走这里）
   * @param {string} name     视图名（VIEW_IDS 的键）
   * @param {boolean} fromHash 这次切换是不是"地址栏变化"引起的
   */
  function switchView(name, fromHash) {
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

    // 2、导航按钮：同步高亮状态 + 读屏状态（Day 13）
    document.querySelectorAll('.nav-btn[data-view]').forEach(function (btn) {
      /* ⭐ 视觉状态和读屏状态**从同一个 isCurrent 派生** —— 不要各写一遍。
         DESIGN.md 8.3 的教训："一个状态分两处各写一半，必然漏一边。"
         （Day 12 的筛选栏 chip 就是这么改的：is-active 和 aria-pressed 同源。）
         ⭐ `aria-current="page"` 是**导航**的标准做法 ——
            读屏会念出"当前页"，用户才知道自己在哪一块。
         ⚠️ 门面页不在导航里 → 没有按钮匹配 → 所有按钮的 aria-current 都会被清掉 ✓ 正确。 */
      var isCurrent = (btn.dataset.view === name);
      btn.classList.toggle('is-active', isCurrent);
      if (isCurrent) {
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.removeAttribute('aria-current');
      }
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

    /* 5、把这次切换记到地址栏上（Day 13）
          ⚠️ 放在**最后**：万一它失败（比如 file:// 下 pushState 抛异常），
             前面的视图切换也已经完成了 —— 不能让它拖垮主流程。 */
    syncHash(name, fromHash);
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

  /**
   * 「导入 JSON」—— 用户选完文件之后走这里（Day 11 重做补）
   *
   * ⚠️ 导入是**整体替换**（和导出的"完整快照"语义对称），
   *    所以只要现在有数据，就先让用户确认一次 —— 不能默默冲掉。
   * ⚠️ 确认放在**读文件之前**：让用户在等待之前就决定，
   *    而不是读完半天才问"要不要覆盖"。
   * ⚠️ 结果一律走 showAlert（今天刚做的提示条），
   *    成功=绿色自动消失，失败=橙色留着 —— 和别处的反馈口径一致。
   */
  function handleImportFile(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) {
      return;
    }
    var Store = window.TripMemoStore;
    if (!Store || !Store.importJSON) {
      showAlert('数据层尚未就绪，暂时无法导入。', 'error');
      return;
    }

    var current = Store.listPlaces().length;
    if (current > 0) {
      var go = window.confirm(
        '导入会用文件里的内容替换现在的 ' + current + ' 个地点。\n\n'
        + '继续吗？（想留个底，就先点「导出 JSON」存一份）'
      );
      if (!go) {
        return;
      }
    }

    var reader = new FileReader();
    reader.onerror = function () {
      showAlert('读文件失败：' + ((reader.error && reader.error.name) || '未知原因'), 'error');
    };
    reader.onload = function () {
      var result = Store.importJSON(String(reader.result));
      if (!result.ok) {
        showAlert('导入失败：' + result.reason, 'error');
        return;
      }
      console.log('[TripMemo] 已导入 ' + result.count + ' 个地点');
      showAlert('已导入 ' + result.count + ' 个地点', 'ok');
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------
     ⭐ Day 23 移除：「载入示例数据」按钮的整套前端代码

     ⚠️ 为什么删：这是**开发和演示用的工具** —— 访客点一下，
        界面就会被 13 条**假地点**填满，而他并不知道那些是假的。
        ⭐ 一个"给所有人用"的站点不该有这个入口。

     ⭐ 删掉的只是「入口」这一层，**能力还在**：
        · `js/store.js` 里 `loadSampleData()` / `clearSampleData()` 都还在
        · `js/mock-data.js` 里的 13 条示例数据也还在
        ⚠️ 将来做演示 / 自测，直接在浏览器 Console 里调：
             TripMemoStore.loadSampleData()      ← 载入示例
             TripMemoStore.clearSampleData()     ← 还原原有数据

     ⚠️ 一起删掉的还有 `refreshSampleLabel()`（刷新按钮文案）——
        按钮都没了，它只会去操作一个不存在的 DOM，纯死代码。
     ------------------------------------------------------------ */

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
  /* ⭐ 错误提示的停留时长（Day 23 新增）
     ⚠️ 原来是"永不消失"，初衷是"怕用户没看见就丢了数据"。
     ⚠️ 但实测后果更糟（2026-10-09 实测）：
        只要出现过一次失败，这条红字就**永远挂在屏幕上**；
        ⭐ 而且它还会**吞掉后面所有的成功提示**（见 showAlert 里那句 alertKind 判断）——
        于是网络恢复之后，用户每次保存成功都看不到「已保存」，会以为一直在失败。
     ⭐ 所以改成：停留 8 秒（成功提示 3 秒的两倍多，足够看见），然后自动淡出；
        另外配了一个「关闭 ×」，想立刻收掉就点它。 */
  var ALERT_ERROR_HIDE_MS = 8000;
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
    /* ⭐ Day 23：文字写进**内部的 span**，不要写整条 `bar.textContent` ——
       那样会把里面的「关闭 ×」按钮**一起抹掉**（给浮层加按钮最容易踩的坑）。 */
    var textEl = document.getElementById('app-alert-text');
    if (textEl) {
      textEl.textContent = text;
    } else {
      bar.textContent = text;   /* 兜底：万一 HTML 还是旧结构，至少文字显示得出来 */
    }
    /* ⚠️ 用 classList 只切「成功态」这一个类，**不重置整个 className** ——
       重置会把 is-in 一起抹掉，连续操作时就会闪一下。 */
    bar.classList.toggle('app-alert--ok', isOk);
    /* ⭐ 重新显示前先清掉"淡出态" —— 否则上一次留下的 --out 还挂着，
       新提示会一出现就是透明的（连续操作时必踩）。 */
    bar.classList.remove('app-alert--out');
    bar.removeAttribute('hidden');

    if (!isOk) {
      /* 错误态没有**出现**动画 —— 它需要立刻被看到（原设计意图保留） */
      bar.classList.remove('is-in');
      /* ⭐ 但它不会永远挂着（Day 23）：ALERT_ERROR_HIDE_MS 之后自动收掉。
         ⚠️ 这里原来直接 return —— 等于"错误条从此长在屏幕上"，见常量的说明。 */
      alertTimer = setTimeout(hideAlert, ALERT_ERROR_HIDE_MS);
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

    alertTimer = setTimeout(hideAlert, ALERT_OK_HIDE_MS);
  }

  /**
   * ⭐ 把当前挂着的提示条收掉（Day 23 新增）
   *
   * ⚠️ 两个触发来源：
   *    ① 计时到了（成功 3 秒 / 错误 8 秒）
   *    ② ⭐ 用户点了「关闭 ×」
   *    ⭐ 两条路都走这里 —— **收尾逻辑只能有一处**，
   *       分开写必然会漏掉某个状态没清（本项目"状态同步要集中在一个函数收尾"那条坑）。
   */
  function hideAlert() {
    var bar = document.getElementById('app-alert');
    if (!bar) {
      return;
    }
    if (alertTimer) {
      clearTimeout(alertTimer);
      alertTimer = null;
    }

    var fadeMs = cssDurationMs('--duration-normal', 180);

    /* 先开始淡出……
       ⚠️ 成功态：移除 is-in 就回到"透明 + 上移 8px"的起始态；
       ⭐ 错误态：它本来就没有 is-in（是瞬间出现的），
          所以额外加一个 --out 类，让它也走同一个淡出过渡。 */
    bar.classList.remove('is-in');
    bar.classList.add('app-alert--out');

    alertTimer = setTimeout(function () {
      /* ……等淡出播完再真正隐藏，否则会"淡到一半突然没了" */
      bar.setAttribute('hidden', '');
      alertKind = null;
      alertTimer = null;
    }, fadeMs);
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

  /**
   * ⭐ 页面初始化（Day 20 改）
   *
   * ⚠️ 为什么要在最前面等一次数据：
   *    Day 20 起数据来自云端接口，是**异步**的。
   *    如果不等，各个视图会先画一次"空列表"，等数据到了再重画一遍 ——
   *    ⭐ 用户会看到画面**闪烁**一下。
   *    ⭐ 所以顺序改成：**先把数据拉下来 → 再初始化界面**，
   *       这样视图第一次画出来就是真实数据。
   *
   * ⚠️ 注意**成功和失败都要继续初始化界面**：
   *    失败了也要把界面搭起来，好让「读不到数据」这个错误**显示给用户看** ——
   *    否则页面会是一片空白，用户更不知道出了什么事。
   */
  function init() {
    var Store = window.TripMemoStore;
    if (Store && Store.init) {
      Store.init().then(initViews, initViews);
    } else {
      initViews();
    }
  }

  /** 真正初始化界面的部分（Day 20 从 init 里拆出来，内容没变） */
  function initViews() {
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

    /* 导入按钮 + 隐藏的文件选择器（Day 11 重做补）
       ⚠️ 为什么中间非要过一个 <input type="file">：
          浏览器有安全限制 —— **只有用户亲手点**文件选择框才能选文件，
          脚本不能自己弹出"打开文件"对话框。所以路径是：
            点真按钮 → 脚本去 click() 那个隐藏 input → 用户选文件 → change
       ⚠️ 每次点完都把 input.value 清空：否则**连着两次选同一个文件**
          不会触发 change（值没变），第二次毫无反应。 */
    var importBtn = document.getElementById('btn-import');
    var importFile = document.getElementById('import-file');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', function () {
        importFile.value = '';
        importFile.click();
      });
      importFile.addEventListener('change', handleImportFile);
    }

    /* ⚠️ 错误提示的监听必须**尽早注册**：数据层出错时会广播
       `store:error`，如果监听装晚了，早期错误就漏掉了。
       ⭐ 这一条原来紧跟在「示例数据按钮」的绑定后面 —— Day 23 那个按钮删掉了，
          注释单独留在这里，说明**为什么它必须排在这些位置**：先于各视图初始化。 */
    document.addEventListener('store:error', showStoreError);
    /* ⭐ 提示条上的「关闭 ×」（Day 23）：手动收掉当前这条。
       ⚠️ 它是真 <button> —— Tab / 回车 / 空格都是浏览器自带行为，不用接管键盘。 */
    var alertCloseBtn = document.getElementById('app-alert-close');
    if (alertCloseBtn) {
      alertCloseBtn.addEventListener('click', hideAlert);
    }
    /* 数据变更 → 成功提示（Day 11 重做）。和上面一样，尽早注册。 */
    document.addEventListener('data:change', showDataChangeAlert);
    initGlobalErrorWatch();

    /* 站点标题 → 回门面页（Day 11 重做补）
       以前门面页"有进无出"：进去之后没有任何入口能回来，只能刷新页面。
       ⚠️ 这里不用额外写键盘处理 —— 它是真 <button>，
          Tab / 回车 / 空格都是浏览器自带行为，不需要我们接管。 */
    var homeBtn = document.getElementById('nav-home');
    if (homeBtn) {
      homeBtn.addEventListener('click', function () {
        switchView('landing');
      });
    }

    /* 门面页的「开始记录」按钮 → 进地图视图
       ⚠️ 用 switchView 而不是给个 <a href>：这是单页应用，
          没有第二个 URL，切视图才是"进门"的正确做法。 */
    var landingBtn = document.getElementById('landing-enter');
    if (landingBtn) {
      landingBtn.addEventListener('click', function () {
        switchView('map');
      });
    }

    /* 显示视图：**先看地址栏**（Day 13）——
       这样刷新后停在原来那个视图，链接也能直接分享给别人。
       ⚠️ fromHash=true：初始视图本来就"来自地址栏"，不该再写一条历史 ——
          否则每刷新一次就多一条记录，后退键要按好几下才出得去。 */
    switchView(readHashView(), true);

    /* ⚠️ 地址栏里挂着一个认不出来的视图名（比如别人发来的 #xxx）→ 把它清掉。
       不清的话，地址栏会一直挂着一个和画面不符的 hash，看着就像坏了。 */
    if (location.hash && !VIEW_IDS[location.hash.replace(/^#/, '')]) {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch (err) {
        console.warn('[TripMemo] 清掉无效 hash 失败：', err);
      }
      console.log('[TripMemo] 地址栏里的视图名认不出来，已回到默认视图');
    }

    /* 用户按「后退 / 前进」或直接改地址栏 → 跟着切视图（Day 13）
       ⚠️ 传 fromHash=true，**绝不再写 hash** ——
          否则会出现"后退永远退不完"（每次后退又压一条新历史）。 */
    window.addEventListener('hashchange', function () {
      switchView(readHashView(), true);
    });

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

    console.log('[TripMemo] 骨架已就绪，当前视图：' + currentView);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
