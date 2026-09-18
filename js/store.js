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

  /* 内存中的缓存：避免每次都读 localStorage */
  var placesCache = null;
  var settingsCache = null;

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
      console.error('[TripMemo] 无法读取本地存储：', err);
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
      console.error('[TripMemo] 本地数据解析失败，已按空数据继续：', err);
      placesCache = [];
    }
    return placesCache;
  }

  /** 把内存缓存写回 localStorage，并广播变更事件 */
  function persist() {
    try {
      global.localStorage.setItem(KEY_PLACES, JSON.stringify(placesCache));
    } catch (err) {
      console.error('[TripMemo] 写入本地存储失败：', err);
    }
    /* 通知界面刷新 —— 各视图监听到后自己重画 */
    document.dispatchEvent(new CustomEvent('data:change', {
      detail: { count: placesCache.length }
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
    persist();
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
        persist();
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
        list.splice(i, 1);
        persist();
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
      console.error('[TripMemo] 无法读取本地设置：', err);
      settingsCache = {};
      return settingsCache;
    }
    try {
      settingsCache = raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.error('[TripMemo] 本地设置解析失败，已按空设置继续：', err);
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
      console.error('[TripMemo] 写入本地设置失败：', err);
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
     四、对外暴露
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
    downloadJSON: downloadJSON
  };

}(window));
