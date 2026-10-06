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

  /* ⭐ 当前表单里"待保存的照片"列表（Day 21）
     每一项：{ fileID, uploading, failed, previewUrl }
     ⚠️ 为什么单独维护一份、而不是直接读 DOM：
        上传是异步的 —— 用户可能"选完就点保存"，那时 fileID 还没回来。
        这份列表能如实反映每张的状态（✅完成 / ⏳上传中 / ❌失败）。 */
  var pendingPhotos = [];

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
    /* ⭐ 照片相关（Day 21） */
    el.photoStrip = document.getElementById('photo-strip');
    el.btnAddPhoto = document.getElementById('btn-add-photo');
    el.photoInput = document.getElementById('photo-input');
    el.photoHint  = document.getElementById('photo-hint');

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

    /* ⭐ 把已有的照片装进待保存列表（Day 21）
       ⚠️ 已存在的只有 fileID，没有本地预览图 —— 要异步去换链接。 */
    pendingPhotos = (p.images || []).map(function (fileID) {
      return { fileID: fileID, uploading: false, failed: false, previewUrl: '' };
    });
    renderPhotos();
    loadExistingPhotoUrls();

    hideFormError();
  }

  /* ------------------------------------------------------------
     四之二、照片（Day 21）
     ------------------------------------------------------------ */

  /** ⭐ 把 pendingPhotos 画成缩略图 */
  function renderPhotos() {
    if (!el.photoStrip) {
      return;
    }
    el.photoStrip.innerHTML = '';

    pendingPhotos.forEach(function (ph, idx) {
      var box = document.createElement('div');
      box.className = 'photo-thumb'
        + (ph.uploading ? ' is-uploading' : '')
        + (ph.failed ? ' is-failed' : '');

      var img = document.createElement('img');
      img.src = ph.previewUrl || '';
      img.alt = '';
      box.appendChild(img);

      /* ⚠️ 上传中/失败要盖一层文字 —— 否则用户以为没反应，反复点添加 */
      if (ph.uploading || ph.failed) {
        var st = document.createElement('div');
        st.className = 'photo-thumb-status';
        st.textContent = ph.uploading ? '上传中…' : '失败';
        box.appendChild(st);
      }

      /* ⭐ 封面（Day 21）：
         规则是"第一张就是封面"，所以"设为封面"其实 = **把这张挪到第一位** ——
         ⚠️ 这样不用给数据库加 coverIndex 字段，也不用改接口，
            而且三个用到封面的地方（地点缩略图 / 城市分组头 / 抽屉顶部）会自动跟着变。 */
      if (idx === 0) {
        var mark = document.createElement('span');
        mark.className = 'photo-cover-mark';
        mark.textContent = '封面';
        box.appendChild(mark);
      } else {
        var setCover = document.createElement('button');
        setCover.type = 'button';
        setCover.className = 'photo-cover-btn';
        setCover.textContent = '设为封面';
        setCover.title = '把这张作为封面（会自动排到第一张）';
        setCover.addEventListener('click', function () { makeCover(idx); });
        box.appendChild(setCover);
      }

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'photo-del';
      del.textContent = '×';
      del.title = '移除这张';
      del.addEventListener('click', function () { removePhotoAt(idx); });
      box.appendChild(del);

      el.photoStrip.appendChild(box);
    });

    updatePhotoHint();
  }

  function updatePhotoHint() {
    if (!el.photoHint) {
      return;
    }
    var uploading = pendingPhotos.filter(function (x) { return x.uploading; }).length;
    if (uploading > 0) {
      el.photoHint.textContent = '正在上传 ' + uploading + ' 张…';
      return;
    }
    var ok = pendingPhotos.filter(function (x) { return x.fileID; }).length;
    el.photoHint.textContent = ok
      ? ('已添加 ' + ok + ' 张；点右上角 × 可移除')
      : '可多选；上传前会自动压缩';
  }

  /**
   * ⭐ 为"已存在"的照片异步换取显示链接
   * ⚠️ 只处理还没有 previewUrl 的（不要重复请求）
   */
  function loadExistingPhotoUrls() {
    var need = pendingPhotos.filter(function (x) { return x.fileID && !x.previewUrl; });
    if (!need.length) {
      return;
    }
    var ids = need.map(function (x) { return x.fileID; });

    Store.resolvePhotoUrls(ids).then(function (list) {
      list.forEach(function (item) {
        pendingPhotos.forEach(function (x) {
          if (x.fileID === item.fileID && !x.previewUrl) {
            x.previewUrl = item.url;
          }
        });
      });
      renderPhotos();
    }).catch(function (err) {
      console.warn('[TripMemo] 照片链接换取失败：', err);
    });
  }

  /** ⭐ 用户选了文件 → 逐个上传 */
  function handlePhotoFiles(files) {
    var arr = Array.prototype.slice.call(files || []);
    if (!arr.length) {
      return;
    }

    /* ⚠️ 上传要一个"地点 id"来建目录。⭐ 新增态还没 id ——
       用一个临时前缀顶着；不影响功能，只是云存储里目录名不同。 */
    var placeId = currentId || ('draft_' + Date.now().toString(36));

    arr.forEach(function (file) {
      var item = {
        fileID: null,
        uploading: true,
        failed: false,
        /* ⭐ 本地预览（URL.createObjectURL）—— 不用等上传完就能看见图 */
        previewUrl: (global.URL && global.URL.createObjectURL) ? global.URL.createObjectURL(file) : ''
      };
      pendingPhotos.push(item);
      renderPhotos();

      Store.uploadPhoto(file, placeId).then(function (fileID) {
        item.fileID = fileID;
        item.uploading = false;
        renderPhotos();
      }).catch(function (err) {
        item.uploading = false;
        item.failed = true;
        renderPhotos();
        console.error('[TripMemo] 照片上传失败：', err);
        if (el.photoHint) {
          el.photoHint.textContent = '上传失败：' + ((err && err.message) || err);
        }
      });
    });
  }

  /**
   * ⭐ 把第 idx 张设为封面（Day 21）
   * ⭐ 做法：**把它挪到数组第一位** ——
   *    "封面 = 第一张"这条规则在三个地方用着（地点缩略图 / 城市分组头 / 抽屉顶部），
   *    所以只要顺序变了，三处会自动跟着变，⚠️ 不用给数据库加字段。
   */
  function makeCover(idx) {
    if (idx <= 0 || idx >= pendingPhotos.length) {
      return;
    }
    var item = pendingPhotos.splice(idx, 1)[0];
    pendingPhotos.unshift(item);
    renderPhotos();
  }

  /** ⭐ 移除第 idx 张（只从"待保存列表"里去掉；云端文件不删） */
  function removePhotoAt(idx) {
    var item = pendingPhotos[idx];
    if (!item) {
      return;
    }
    if (item.previewUrl && item.previewUrl.indexOf('blob:') === 0 && global.URL) {
      global.URL.revokeObjectURL(item.previewUrl);   /* ⭐ 释放本地预览占的内存 */
    }
    pendingPhotos.splice(idx, 1);
    renderPhotos();
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
      /* ⭐ 照片（Day 21）：只取**上传成功**的那些；
         ⚠️ 还在传 / 传失败的不写进数据库 —— 否则会存进去一个空 fileID。 */
      images:     pendingPhotos
                    .filter(function (x) { return !!x.fileID; })
                    .map(function (x) { return x.fileID; })
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
    pendingPhotos = [];      /* ⭐ 新增态必须是干净的（Day 21） */
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

    /* ⭐ 照片：按钮 → 隐藏的 file input → change（Day 21）
       ⚠️ 中间非要过一次 <input type="file">：浏览器安全限制 ——
          只有用户亲手点才能弹文件框，脚本不能自己弹。
       ⚠️ 每次点完把 value 清空：否则连着两次选同一个文件不会触发 change。 */
    if (el.btnAddPhoto && el.photoInput) {
      el.btnAddPhoto.addEventListener('click', function () {
        el.photoInput.value = '';
        el.photoInput.click();
      });
      el.photoInput.addEventListener('change', function () {
        handlePhotoFiles(el.photoInput.files);
      });
    }

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
