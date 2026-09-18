/* ============================================================
   TripMemo 地点详情弹窗（js/detail.js）

   一个弹窗，三种形态（PRD 5.4）：
     查看态 —— 只读展示，底部一个「编辑」按钮
     编辑态 —— 字段可改，底部「删除」「取消」「保存」
     新增态 —— 字段为空，底部「取消」「保存」

   这样做的好处：用户点开一个地点是想「看」，不会一进去就进了编辑框，
   手一滑就改了不该改的东西。

   Day 7 · 步骤 2c-①
   ============================================================ */

(function (global) {
  'use strict';

  var Model = global.TripMemoModel;
  var Store = global.TripMemoStore;

  /* 弹窗当前的形态：'view' | 'edit' | 'new' */
  var mode = 'view';

  /* 当前正在看/改的地点 id（新增态为 null） */
  var currentId = null;

  /* 新增态用的坐标（用户点地图时带进来的） */
  var draftCoords = { lng: NaN, lat: NaN };

  /* DOM 引用，初始化时取一次 */
  var el = {};

  /* ------------------------------------------------------------
     一、取 DOM
     ------------------------------------------------------------ */
  function cacheDom() {
    el.modal      = document.getElementById('modal-detail');
    el.title      = document.getElementById('modal-title');
    el.view       = document.getElementById('modal-view');
    el.list       = document.getElementById('detail-list');
    el.form       = document.getElementById('modal-form');
    el.formError  = document.getElementById('form-error');
    el.foot       = document.getElementById('modal-foot');
    el.btnClose   = document.getElementById('modal-close');

    el.f = {
      name:  document.getElementById('f-name'),
      city:  document.getElementById('f-city'),
      type:  document.getElementById('f-type'),
      start: document.getElementById('f-start'),
      end:   document.getElementById('f-end'),
      note:  document.getElementById('f-note'),
      tags:  document.getElementById('f-tags')
    };
  }

  /* ------------------------------------------------------------
     二、渲染：类型下拉
     ------------------------------------------------------------ */
  function fillTypeOptions() {
    if (!el.f.type) {
      return;
    }
    el.f.type.innerHTML = '';
    Model.PLACE_TYPES.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t.key;
      opt.textContent = t.label;
      el.f.type.appendChild(opt);
    });
  }

  /* ------------------------------------------------------------
     三、查看态：把地点渲染成只读列表
     ------------------------------------------------------------ */
  function renderView(place) {
    if (!el.list) {
      return;
    }
    el.list.innerHTML = '';

    /* 「想去」显示「下一站」，不显示停留时段（PRD 4.1 特殊规则） */
    var stayText = place.type === Model.WISHLIST_KEY
      ? '下一站（还没去过）'
      : Model.stayLabel(place);

    var rows = [
      ['地点名称', place.name],
      ['所属城市', place.city],
      ['地点类型', Model.typeLabel(place.type)],
      ['停留时段', stayText],
      ['回忆正文', place.note || '—'],
      ['标签', place.tags && place.tags.length ? place.tags.join('、') : '—']
    ];

    rows.forEach(function (row) {
      var dt = document.createElement('dt');
      dt.textContent = row[0];
      var dd = document.createElement('dd');
      dd.textContent = row[1];
      el.list.appendChild(dt);
      el.list.appendChild(dd);
    });
  }

  /* ------------------------------------------------------------
     四、表单：填充与读取
     ------------------------------------------------------------ */
  function fillForm(place) {
    var p = place || {};
    el.f.name.value  = p.name || '';
    el.f.city.value  = p.city || '';
    el.f.type.value  = p.type || 'short';
    el.f.start.value = p.startMonth || '';
    el.f.end.value   = p.endMonth || '';
    el.f.note.value  = p.note || '';
    el.f.tags.value  = (p.tags && p.tags.length) ? p.tags.join(', ') : '';
    hideFormError();
  }

  /** 标签输入框按逗号拆成数组；中英文逗号都支持 */
  function parseTags(text) {
    if (!text) {
      return [];
    }
    return text.split(/[,，]/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  function readForm() {
    return {
      id:         currentId || undefined,
      name:       el.f.name.value,
      city:       el.f.city.value,
      type:       el.f.type.value,
      startMonth: el.f.start.value,
      endMonth:   el.f.end.value,
      note:       el.f.note.value,
      tags:       parseTags(el.f.tags.value),
      /* 编辑时保留原有坐标与图片；新增时用点击处的坐标 */
      lng:        currentId ? (Store.getPlace(currentId) || {}).lng : draftCoords.lng,
      lat:        currentId ? (Store.getPlace(currentId) || {}).lat : draftCoords.lat,
      images:     currentId ? ((Store.getPlace(currentId) || {}).images || []) : []
    };
  }

  /* ------------------------------------------------------------
     五、底部按钮（按形态生成）
     ------------------------------------------------------------ */
  function makeButton(label, action, modifier) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn' + (modifier ? ' btn--' + modifier : '');
    btn.textContent = label;
    btn.addEventListener('click', action);
    return btn;
  }

  function renderFoot() {
    if (!el.foot) {
      return;
    }
    el.foot.innerHTML = '';

    if (mode === 'view') {
      el.foot.appendChild(makeButton('编辑', function () { switchTo('edit'); }, 'primary'));

    } else if (mode === 'edit') {
      el.foot.appendChild(makeButton('删除', handleDelete, 'danger'));
      el.foot.appendChild(makeButton('取消', close));
      el.foot.appendChild(makeButton('保存', handleSave, 'primary'));

    } else {  /* new */
      el.foot.appendChild(makeButton('取消', close));
      el.foot.appendChild(makeButton('保存', handleSave, 'primary'));
    }
  }

  /* ------------------------------------------------------------
     六、切形态
     ------------------------------------------------------------ */
  function switchTo(nextMode) {
    mode = nextMode;

    var isFormVisible = (mode === 'edit' || mode === 'new');

    /* 查看态与表单互斥显示 */
    el.view.hidden = isFormVisible;
    el.form.hidden = !isFormVisible;

    /* 标题跟着变 */
    el.title.textContent =
      mode === 'view' ? '地点详情' :
      mode === 'edit' ? '编辑地点' : '新增地点';

    renderFoot();

    if (mode === 'edit' && currentId) {
      fillForm(Store.getPlace(currentId));
    }
  }

  /* ------------------------------------------------------------
     七、三个入口
     ------------------------------------------------------------ */

  /**
   * 新增态：点地图空白处进来，带上点击处的坐标
   * @param {number} lng 经度
   * @param {number} lat 纬度
   * @param {Object} [prefill] 预填内容（用搜索选点进来时，会带地名与城市）
   */
  function openNew(lng, lat, prefill) {
    currentId = null;
    draftCoords = { lng: lng, lat: lat };
    fillForm(prefill || null);
    switchTo('new');
    showModal();

    if (prefill && prefill.name) {
      /* 名称和城市已经填好了，光标直接跳到"停留开始时间" */
      if (el.f.start) {
        el.f.start.focus();
      }
    } else if (el.f.name) {
      el.f.name.focus();
    }
  }

  /** 查看态：点地图上的点、时间轴卡片、列表条目进来 */
  function openView(placeId) {
    var place = Store.getPlace(placeId);
    if (!place) {
      window.alert('找不到这个地点，可能已被删除。');
      return;
    }
    currentId = placeId;
    renderView(place);
    switchTo('view');
    showModal();
  }

  /* ------------------------------------------------------------
     八、显示 / 关闭
     ------------------------------------------------------------ */
  function showModal() {
    el.modal.removeAttribute('hidden');
  }

  /**
   * 关闭弹窗
   * 编辑态 / 新增态关闭前确认一下 —— 免得手滑丢掉刚写的内容
   */
  function close() {
    var isFormVisible = (mode === 'edit' || mode === 'new');
    if (isFormVisible) {
      if (!window.confirm('关闭后未保存的内容会丢失，确定关闭吗？')) {
        return;
      }
    }
    el.modal.setAttribute('hidden', '');
    currentId = null;
    hideFormError();
  }

  /* ------------------------------------------------------------
     九、保存与删除
     ------------------------------------------------------------ */
  function showFormError(text) {
    if (el.formError) {
      el.formError.textContent = text;
      el.formError.removeAttribute('hidden');
    }
  }

  function hideFormError() {
    if (el.formError) {
      el.formError.setAttribute('hidden', '');
    }
  }

  function handleSave() {
    var input = readForm();

    /* 必填校验（PRD 验收标准 7）：标题就是"缺哪些"的提示文字 */
    var check = Model.validate(input);
    if (!check.ok) {
      showFormError('还差这些必填项：' + check.missing.join('、'));
      return;
    }

    var result;
    if (mode === 'new') {
      result = Store.addPlace(input);
    } else {
      result = Store.updatePlace(currentId, input);
    }

    if (!result.ok) {
      showFormError('保存失败：' + (result.missing || []).join('、'));
      return;
    }

    /* 保存成功后直接关掉，不再确认 */
    el.modal.setAttribute('hidden', '');
    hideFormError();
    console.log('[TripMemo] 已保存地点：', result.place);
  }

  function handleDelete() {
    if (!currentId) {
      return;
    }
    var place = Store.getPlace(currentId);
    var name = place ? place.name : '这个地点';
    if (!window.confirm('确定删除「' + name + '」吗？删除后无法撤销。')) {
      return;
    }
    Store.removePlace(currentId);
    el.modal.setAttribute('hidden', '');
    currentId = null;
    console.log('[TripMemo] 已删除地点：' + name);
  }

  /**
   * 补填「所属城市」
   *
   * 为什么需要这个函数：搜索选点时，城市名是通过「逆地理编码」异步拿到的。
   * 为了不让弹窗被那个网络请求卡住，弹窗会先打开，城市名拿到之后再补进来。
   *
   * @param {string} city
   */
  function prefillCity(city) {
    if (!city || !el.f || !el.f.city) {
      return;
    }
    /* 只在新增态 / 编辑态生效 */
    if (mode !== 'new' && mode !== 'edit') {
      return;
    }
    /* 用户已经自己填了就不覆盖 */
    if (el.f.city.value.trim()) {
      return;
    }
    el.f.city.value = city;
  }

  /* ------------------------------------------------------------
     十、初始化
     ------------------------------------------------------------ */
  function init() {
    cacheDom();
    if (!el.modal) {
      console.warn('[TripMemo] 没找到详情弹窗容器，弹窗功能不可用');
      return;
    }

    fillTypeOptions();

    /* 关闭按钮 */
    el.btnClose.addEventListener('click', close);

    /* 点遮罩（弹窗外面的灰底）也能关 */
    el.modal.addEventListener('click', function (e) {
      if (e.target === el.modal) {
        close();
      }
    });

    /* Esc 关闭 */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.modal.hasAttribute('hidden')) {
        close();
      }
    });
  }

  global.TripMemoDetail = {
    init: init,
    openNew: openNew,
    openView: openView,
    prefillCity: prefillCity,
    close: close
  };

}(window));
