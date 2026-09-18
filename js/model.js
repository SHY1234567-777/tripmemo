/* ============================================================
   TripMemo 数据模型（js/model.js）

   职责：定义「一个地点」长什么样，以及所有纯计算。
   特点：不碰界面、不碰存储 —— 所以可以单独验证，出错也好定位。

   Day 7 · 步骤 2b
   对应文档：PRD 六、数据字段 ｜ PRD 4.1 #3 点的视觉差异
   ============================================================ */

(function (global) {
  'use strict';

  /* ------------------------------------------------------------
     一、地点类型（PRD 4.1 #2）
     存英文 key（给机器看），显示中文 label（给人看）
     ------------------------------------------------------------ */
  var PLACE_TYPES = [
    { key: 'long',     label: '长期居住' },
    { key: 'short',    label: '短期停留' },
    { key: 'travel',   label: '旅游' },
    { key: 'wishlist', label: '想去' }      /* 「想去」= 还没去过，规则见下 */
  ];

  /* 「想去」类型：没有停留时长，点固定为最小尺寸（PRD 4.1 特殊规则） */
  var WISHLIST_KEY = 'wishlist';

  /* 各类型的显示颜色（颜色用来区分"类型"，不表达时长 —— PRD 4.2 #1）
     ⚠️ Day 8 美化改版（最终定稿）：这四个色为【奶油暖色地图底】而选。
        配色思路：整体走"旧地图 / 老照片"的暖色系，
        但不是全都用暖色 —— 那样四个类型会分不清，所以：
          · 长期居住 / 短期停留 用两个"冷调深色"（藏蓝 / 松绿），
            它们是使用频率最高的类型，需要最清楚
          · 旅游 用暖橙（呼应主题色，但要跟主色区分开，所以偏红一点）
          · 想去 用暖灰（低存在感，因为它是"还没去过"的）
        四者的明度差保持在可辨识范围内。 */
  var TYPE_COLORS = {
    long:     '#2F5D8A',   /* 长期居住：藏蓝（最沉稳，时间最长的类型） */
    short:    '#3D7A5F',   /* 短期停留：松绿 */
    travel:   '#C9761F',   /* 旅游：暖橙（主题色同源，偏红以示区分） */
    wishlist: '#9C9287'    /* 想去：暖灰（低存在感） */
  };

  /* ------------------------------------------------------------
     二、点大小的算法参数（PRD 4.1 #3、5.1 视觉要求）
     ------------------------------------------------------------ */
  var DOT_MIN = 8;          /* 最小直径（像素） */
  var DOT_MAX = 34;         /* 最大直径（像素） */
  var MONTHS_FULL = 120;    /* 停留满 10 年 = 达到最大直径 */

  /* ------------------------------------------------------------
     三、停留时长
     ------------------------------------------------------------ */

  /**
   * 把 'YYYY-MM' 转成 Date（取当月 1 日）
   * @param {string} ym 形如 '2019-09'
   * @returns {Date|null}
   */
  function parseMonth(ym) {
    if (!ym || typeof ym !== 'string') {
      return null;
    }
    var parts = ym.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (isNaN(y) || isNaN(m)) {
      return null;
    }
    return new Date(y, m - 1, 1);
  }

  /**
   * 计算停留月数
   * 结束时间为空 → 算到「今天」（表示"至今"）
   * @param {Object} place 地点对象
   * @returns {number} 月数（不足 0 时返回 0）
   */
  function monthsOfStay(place) {
    var start = parseMonth(place && place.startMonth);
    if (!start) {
      return 0;
    }
    var end = parseMonth(place.endMonth) || new Date();
    var months = (end.getFullYear() - start.getFullYear()) * 12
               + (end.getMonth() - start.getMonth());
    return months > 0 ? months : 0;
  }

  /**
   * 停留时长的显示文案（PRD 验收标准 8 / 20）
   *   有结束时间 → '2019-09 ~ 2021-06'
   *   无结束时间 → '2019-09 至今'
   *   没填开始时间 → '—'
   */
  function stayLabel(place) {
    if (!place || !place.startMonth) {
      return '—';
    }
    return place.endMonth
      ? place.startMonth + ' ~ ' + place.endMonth
      : place.startMonth + ' 至今';
  }

  /* ------------------------------------------------------------
     四、点的直径（PRD 验收标准 4 / 24 / 30）
     用平方根映射：让"几天"和"几个月"的差别看得出来，
     同时不让"十年"的点大到遮住地图
     ------------------------------------------------------------ */

  /**
   * @param {Object} place
   * @returns {number} 直径（像素）
   */
  function dotDiameter(place) {
    /* 「想去」固定最小尺寸，不参与大小映射（PRD 验收标准 30） */
    if (!place || place.type === WISHLIST_KEY) {
      return DOT_MIN;
    }
    var months = monthsOfStay(place);
    if (months <= 0) {
      return DOT_MIN;
    }
    var capped = Math.min(months, MONTHS_FULL);
    var ratio = Math.sqrt(capped / MONTHS_FULL);
    return Math.round(DOT_MIN + (DOT_MAX - DOT_MIN) * ratio);
  }

  /* ------------------------------------------------------------
     四之二、连线的线宽（PRD 4.1 #8 / 验收标准 18、19）

     线宽表达的是「这座城市对我有多重」——住得越久，线越粗。
     和点一样用平方根映射，并且有上下限：
     最粗的线不会粗成一条带，最细的线也不会细到看不见。
     ------------------------------------------------------------ */
  var LINE_MIN = 1.5;      /* 最小线宽（像素） */
  var LINE_MAX = 8;        /* 最大线宽（像素） */

  /**
   * @param {number} months 该城市的累计停留月数
   * @returns {number} 线宽（像素）
   */
  function lineWidthByMonths(months) {
    if (!months || months <= 0) {
      return LINE_MIN;
    }
    var capped = Math.min(months, MONTHS_FULL);
    var ratio = Math.sqrt(capped / MONTHS_FULL);
    var width = LINE_MIN + (LINE_MAX - LINE_MIN) * ratio;
    return Math.round(width * 10) / 10;   /* 保留一位小数 */
  }

  /* ------------------------------------------------------------
     四之三、按城市聚合（连线要按"城市"画，不是按"点"画）

     为什么：如果每个点各连一条线，同一个城市下 3 个地点就会
     连出 3 条几乎重叠的线，线宽互相盖住，什么也看不出来。
     按城市聚合成一条，线宽才讲得通（PRD 验收标准 16）。
     ------------------------------------------------------------ */

  /**
   * @param {Array} places 地点数组
   * @returns {Array<{city, count, totalMonths, lng, lat}>}
   *          lng/lat 是该城市下所有地点的中心点
   *          城市为空的地点不参与（对应 PRD 待反馈问题 #2）
   */
  function cityStats(places) {
    var bucket = {};
    var order = [];

    (places || []).forEach(function (place) {
      if (!place.city) {
        return;
      }
      if (!bucket[place.city]) {
        bucket[place.city] = { city: place.city, count: 0, totalMonths: 0, sumLng: 0, sumLat: 0 };
        order.push(place.city);
      }
      var item = bucket[place.city];
      item.count += 1;
      item.totalMonths += monthsOfStay(place);
      item.sumLng += Number(place.lng) || 0;
      item.sumLat += Number(place.lat) || 0;
    });

    return order.map(function (city) {
      var item = bucket[city];
      return {
        city: item.city,
        count: item.count,
        totalMonths: item.totalMonths,
        lng: item.sumLng / item.count,
        lat: item.sumLat / item.count
      };
    });
  }

  /* ------------------------------------------------------------
     五、新建地点对象（PRD 六、数据字段）
     ------------------------------------------------------------ */

  /** 生成一个不会重复的 id */
  function newId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  /**
   * 用表单输入拼出一个完整的地点对象
   * @param {Object} input 可能只填了一部分
   * @returns {Object} 规范化的地点对象
   */
  function createPlace(input) {
    var src = input || {};
    return {
      id:          src.id || newId(),
      name:        (src.name || '').trim(),                       /* 1 地点名称 */
      city:        (src.city || '').trim(),                       /* 2 所属城市 */
      lng:         Number(src.lng),                               /* 3 坐标·经度 */
      lat:         Number(src.lat),                               /* 3 坐标·纬度 */
      type:        src.type || '',                                /* 4 地点类型 */
      startMonth:  src.startMonth || '',                          /* 5 停留开始时间 */
      endMonth:    src.endMonth || '',                            /* 6 停留结束时间 */
      /* 7 停留时长 —— 计算字段，不存（每次由 monthsOfStay 算） */
      note:        src.note || '',                                /* 8 回忆正文 */
      tags:        Array.isArray(src.tags) ? src.tags.slice() : [],/* 9 标签列表 */
      /* 10 图片（本期只留字段、不实现上传）
         必须沿用传入的值，否则将来加了照片后，一编辑就会被清空 */
      images:      Array.isArray(src.images) ? src.images.slice() : [],
      createdAt:   src.createdAt || new Date().toISOString()
    };
  }

  /* ------------------------------------------------------------
     六、必填校验（PRD 验收标准 7）
     ------------------------------------------------------------ */
  var REQUIRED_FIELDS = [
    { key: 'name', label: '地点名称' },
    { key: 'city', label: '所属城市' },
    { key: 'type', label: '地点类型' }
  ];

  /**
   * @param {Object} input
   * @returns {{ok: boolean, missing: string[]}}
   */
  function validate(input) {
    var src = input || {};
    var missing = [];
    REQUIRED_FIELDS.forEach(function (field) {
      if (!src[field.key]) {
        missing.push(field.label);
      }
    });
    return { ok: missing.length === 0, missing: missing };
  }

  /** 按 key 取中文名（找不到就返回 key 本身） */
  function typeLabel(key) {
    for (var i = 0; i < PLACE_TYPES.length; i++) {
      if (PLACE_TYPES[i].key === key) {
        return PLACE_TYPES[i].label;
      }
    }
    return key;
  }

  /**
   * 城市名规范化
   * 为什么需要：用户手填可能写「武汉市」，而高德逆地理编码返回的是「武汉」。
   *           不归一化就会出现"明明是同一个城市，却分成两组、连不上线"。
   * @param {string} name
   * @returns {string}
   */
  function normalizeCity(name) {
    if (!name) {
      return '';
    }
    return String(name)
      .trim()
      .replace(/市$/, '')
      .replace(/特别行政区$/, '')
      .replace(/自治州$/, '')
      .replace(/地区$/, '');
  }

  /** 两个城市名是不是同一个城市 */
  function isSameCity(a, b) {
    return normalizeCity(a) !== '' && normalizeCity(a) === normalizeCity(b);
  }

  /* ------------------------------------------------------------
     七、对外暴露
     ------------------------------------------------------------ */
  global.TripMemoModel = {
    PLACE_TYPES: PLACE_TYPES,
    WISHLIST_KEY: WISHLIST_KEY,
    TYPE_COLORS: TYPE_COLORS,
    DOT_MIN: DOT_MIN,
    DOT_MAX: DOT_MAX,
    LINE_MIN: LINE_MIN,
    LINE_MAX: LINE_MAX,
    parseMonth: parseMonth,
    monthsOfStay: monthsOfStay,
    stayLabel: stayLabel,
    dotDiameter: dotDiameter,
    lineWidthByMonths: lineWidthByMonths,
    cityStats: cityStats,
    createPlace: createPlace,
    validate: validate,
    typeLabel: typeLabel,
    normalizeCity: normalizeCity,
    isSameCity: isSameCity
  };

}(window));
