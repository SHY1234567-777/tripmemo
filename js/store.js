/* ============================================================
   TripMemo 数据层（js/store.js）

   职责：所有数据的读写都从这里走 —— 全项目唯一的"数据出口"。
   为什么单独一个文件：以后换成云数据库时，只需要改这一个文件，
                      界面代码一行都不用动（见 TECH_DESIGN 2.3）。

   存储位置：浏览器 localStorage（PRD 第八节）
   Day 7 · 步骤 2b
   ============================================================ */

(function (global) {
  'use strict';

  var Model = global.TripMemoModel;

  /* localStorage 的键名 —— 带版本号，以后结构变了可以平滑升级 */
  var KEY_PLACES = 'tripmemo.places.v1';
  var KEY_SETTINGS = 'tripmemo.settings.v1';   /* 全局设置（目前只有主城市） */

  /* 载入示例数据前，把用户原有数据备份到这个键（Day 8）
     只在"还没有备份"时才写 —— 防止手滑点两次把备份覆盖成示例数据 */
  var KEY_BACKUP = 'tripmemo.backup.v1';

  /* 内存中的缓存：避免每次都读 localStorage */
  var placesCache = null;
  var settingsCache = null;

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
  function listPlaces() {
    if (placesCache !== null) {
      return placesCache;
    }
    var raw = null;
    try {
      raw = global.localStorage.getItem(KEY_PLACES);
    } catch (err) {
      /* 浏览器禁用了 localStorage（隐私模式等） */
      reportError('读取地点', err);
      placesCache = [];
      return placesCache;
    }
    if (!raw) {
      placesCache = [];
      return placesCache;
    }
    try {
      var parsed = JSON.parse(raw);
      placesCache = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      reportError('解析地点数据', err);
      placesCache = [];
    }
    return placesCache;
  }

  /** 把内存缓存写回 localStorage，并广播变更事件 */
  function persist(action, place) {
    try {
      global.localStorage.setItem(KEY_PLACES, JSON.stringify(placesCache));
    } catch (err) {
      reportError('保存地点', err);
    }
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
          var merged = Model.createPlace(Object.assign({}, list[i], input, { id: id }));
          list[i] = merged;
          persist('update', merged);
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
    var raw = null;
    try {
      raw = global.localStorage.getItem(KEY_SETTINGS);
    } catch (err) {
      reportError('读取设置', err);
      settingsCache = {};
      return settingsCache;
    }
    try {
      settingsCache = raw ? JSON.parse(raw) : {};
    } catch (err) {
      reportError('解析设置数据', err);
      settingsCache = {};
    }
    if (!settingsCache || typeof settingsCache !== 'object') {
      settingsCache = {};
    }
    return settingsCache;
  }

  function persistSettings() {
    try {
      global.localStorage.setItem(KEY_SETTINGS, JSON.stringify(settingsCache));
    } catch (err) {
      reportError('保存设置', err);
    }
    document.dispatchEvent(new CustomEvent('settings:change', {
      detail: { mainCity: getMainCity() }
    }));
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

  /* ------------------------------------------------------------
     五、示例数据（Day 8）

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
    getPlace: getPlace,
    addPlace: addPlace,
    updatePlace: updatePlace,
    removePlace: removePlace,
    filterByType: filterByType,
    getMainCity: getMainCity,
    setMainCity: setMainCity,
    exportJSON: exportJSON,
    downloadJSON: downloadJSON,
    /* Day 8 新增 */
    isSampleLoaded: isSampleLoaded,
    loadSampleData: loadSampleData,
    clearSampleData: clearSampleData,
    getLastError: function () { return lastError; }
  };

}(window));
