/* ============================================================
   placesRepository.js —— places 集合的「数据访问层」（Day 19 新增）
   ============================================================
   ⭐ 这个文件**只管一件事：怎么读写 `places` 集合**。
   ⚠️ 它**不知道 HTTP 存在** —— 看不到 `req`、`res`、状态码、`url`。
   ⚠️ 它**也不负责校验参数合法性**（那是接口层的职责，因为"非法就返 400"是 HTTP 语义）。

   ⭐ 它对外只提供"函数"：
        · findPlaces(...)        查列表
        · findPlaceById(...)     查单个
        · existsAtCoordinate(...) 按坐标查重
        · insertPlace(...)       插入
        · countAll()             数条数（给 db-check 用）

   ⭐⭐ 「Day 19 要掌握」的答案就在这个文件：
       **"查数据库"那段代码，从 index.js 的路由分支里，搬到了这里。**
   ============================================================ */

const dbModule = require('../cloudbase');
const db = dbModule.db;

/* ⚠️ 集合名只在这里出现 —— 上层完全看不到它叫什么。
   ⭐ 好处：将来要改集合名，只改这一行。 */
const COLLECTION = 'places';

/**
 * ⭐ 合法的地点类型（4 个）
 * ⚠️ 为什么放在数据层：这是"地点这个数据有哪几种类型"的知识 —— 属于数据结构定义。
 * ⭐ 接口层（index.js）做参数校验时会引用它，保证**只有一处定义**。
 */
const VALID_PLACE_TYPES = ['long', 'short', 'travel', 'wishlist'];

/**
 * 把数据库的日期转成 ISO 字符串（前端认这个格式）
 * ⚠️ 兼容三种可能：Date 对象 / 字符串 / 空
 */
function toIsoString(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * ⭐ 把数据库里的一条 place 文档，转成接口对外返回的形状
 *
 * ⚠️ 为什么这一步放在数据层（而不是接口层）：
 *    因为**只有数据层知道数据库长什么样** —— `_id` 是这里的叫法、
 *    ISODate 是这里的类型。⭐ 出了这一层，数据就已经是"接口的形状"了。
 *
 * ⚠️ 为什么不能直接把 doc 返回出去：
 *    1. ⭐ `_id` 要改成 `id`（契约 §3.4）
 *    2. ⭐ 时间要转成 ISO 字符串（数据库里是 ISODate 对象）
 *    3. ⚠️ **不直接透传** —— 数据库里可能有内部字段，显式列出来才不会漏出去
 */
function toApiPlace(doc) {
  return {
    id: doc._id,
    ownerId: doc.ownerId || '',
    name: doc.name || '',
    city: doc.city || '',
    lng: doc.lng,
    lat: doc.lat,
    type: doc.type || '',
    startMonth: doc.startMonth || '',
    endMonth: doc.endMonth || '',
    note: doc.note || '',
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    images: Array.isArray(doc.images) ? doc.images : [],
    createdAt: toIsoString(doc.createdAt),
  };
}

/**
 * ⭐ 生成一个新的地点 id（服务端生成，不接受客户端传）
 *
 * ⚠️ 格式必须和前端 `js/model.js` 的 `newId()` **完全一致** ——
 *    因为契约 §3.4 定了"接口层的 id 沿用前端那个格式"，
 *    这样将来导出/导入时旧的 id 不用转换。
 *    ⚠️ 是 **36 进制**（`Date.now().toString(36)`），不是十进制。
 */
function newPlaceId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

/**
 * ⭐ 查地点列表
 *
 * @param {object} options
 * @param {string} options.ownerId  只查这个用户的（必传）
 * @param {string} [options.type]   按类型筛；不传 = 全部
 * @param {number} [options.limit]  限制条数；0 / 不传 = 不限制
 * @returns {Promise<Array>} 已经转成接口形状的地点数组
 *
 * ⚠️ 参数合不合法由**接口层**先校验（它才知道该返 400 还是别的）——
 *    这里只管"按给定条件查"。
 */
async function findPlaces(options) {
  const opts = options || {};
  const where = { ownerId: opts.ownerId };

  if (opts.type) {
    where.type = opts.type;
  }

  const query = db.collection(COLLECTION).where(where);
  const result = (opts.limit && opts.limit > 0)
    ? await query.limit(opts.limit).get()
    : await query.get();

  return (result.data || []).map(toApiPlace);
}

/**
 * ⭐ 按 id 查单个地点
 * @returns {Promise<object|null>} 转成接口形状的地点；找不到返回 null
 * ⚠️ 找不到时返回 null 而不是抛错 —— 让接口层决定是 404 还是别的。
 */
async function findPlaceById(id, ownerId) {
  /* ⚠️ `_id` 是数据库里的主键名（这里查库要用它），
     而对外返回的字段叫 `id` —— 由 toApiPlace() 负责映射。 */
  const result = await db.collection(COLLECTION)
    .where({ _id: id, ownerId: ownerId })
    .limit(1)
    .get();

  const doc = (result.data || [])[0];
  return doc ? toApiPlace(doc) : null;
}

/**
 * ⭐ 按坐标查重（Day 18 定的「防重复」规矩）
 *
 * ⭐ 判重规则：**同一个 ownerId + 同一个坐标（lng / lat 完全相同）**。
 * ⚠️ 只查同一个 ownerId —— 别人去过同一个坐标跟我没关系。
 *
 * @returns {Promise<object|null>} 已存在的那条（**原始文档**，因为 409 提示要带出它的名字）；
 *                                 没有则返回 null
 */
async function findExistingAtCoordinate(ownerId, lng, lat) {
  const result = await db.collection(COLLECTION)
    .where({ ownerId: ownerId, lng: lng, lat: lat })
    .limit(1)
    .get();

  return (result.data || [])[0] || null;
}

/**
 * ⭐ 插入一个地点
 * @param {object} doc 完整文档（**含 `_id` 和 `createdAt`** —— 由接口层组装好）
 * @returns {Promise<object>} 原样返回这个 doc（方便上层接着用）
 */
async function insertPlace(doc) {
  await db.collection(COLLECTION).add(doc);
  return doc;
}

/**
 * ⭐ 修改一个地点（Day 21）
 *
 * ⚠️⚠️ 契约 §四.4 特别强调的一条（关系到"会不会丢数据"）：
 *    请求体里**只传要改的字段，没传的保持原样**。
 *    ⭐ 所以这里**按"字段在不在 patch 里"判断，而不是按"值真不真"** ——
 *       否则用户想把 note 清空（传空字符串）时会被当成"没传"，清不掉。
 *    ⚠️ 绝对不能拿默认值去补没传的字段 —— 那样前端一编辑就会把
 *       `images` / `tags` 这些没带上的数据清空（契约里专门点名了这点）。
 *
 * ⚠️ `_id` / `ownerId` / `createdAt` **不可改** —— 传了也忽略。
 *
 * @param {string} id      要改的地点 id（数据库里叫 `_id`）
 * @param {string} ownerId 当前用户（⭐ 只能改自己的）
 * @param {object} patch   要改的字段
 * @returns {Promise<{ok:boolean, place?:object, reason?:string, clashName?:string}>}
 *          ⭐ 结构化结果（不是抛错）—— 由**接口层**决定映射成 200 / 404 / 409
 */
async function updatePlace(id, ownerId, patch) {
  /* ① 先确认这条存在、而且是你自己的 —— 用同一个查询做，不给"探测别人数据"的机会 */
  const found = await db.collection(COLLECTION)
    .where({ _id: id, ownerId: ownerId })
    .limit(1)
    .get();

  const doc = (found.data || [])[0];
  if (!doc) return { ok: false, reason: 'not_found' };

  /* ② 组装"要更新的字段" —— 只挑 patch 里**明确出现过**的，并且避开不可改字段 */
  const IMMUTABLE = ['_id', 'id', 'ownerId', 'createdAt'];
  const update = {};

  Object.keys(patch || {}).forEach(function (key) {
    if (IMMUTABLE.indexOf(key) !== -1) return;   /* ⚠️ 不可改的字段直接跳过 */
    update[key] = patch[key];
  });

  if (Object.keys(update).length === 0) {
    /* 没有任何可改字段 —— 直接返回当前状态，不算错 */
    return { ok: true, place: toApiPlace(doc) };
  }

  /* ③ ⭐ 查重（Day 18 定的规矩，改的时候同样适用）
        合并之后的坐标不能和**别的**地点撞上 ——
        ⚠️ 所以要**排除自己**，否则"不改坐标只改名字"也会被自己挡住。 */
  const merged = Object.assign({}, doc, update);
  const others = await db.collection(COLLECTION)
    .where({ ownerId: ownerId, lng: merged.lng, lat: merged.lat })
    .limit(2)          /* ⚠️ 取 2 条：因为结果里可能包含自己 */
    .get();
  const clash = (others.data || []).filter(function (d) { return d._id !== id; })[0];
  if (clash) {
    return { ok: false, reason: 'duplicate', clashName: clash.name || '' };
  }

  /* ④ 写回（⭐ 只更新这几个字段，其余原样不动） */
  await db.collection(COLLECTION)
    .doc(id)
    .update(update);

  /* ⑤ 返回"更新后的完整对象"（契约 §四.4 要求 200 + 完整 place） */
  return { ok: true, place: toApiPlace(merged) };
}

/**
 * ⭐ 删除一个地点（Day 22）
 *
 * ⚠️ 这是**硬删除** —— 真从数据库里删掉，删了找不回来。
 *    契约 §四.5 明确写了"本期不引入 deleted 标记"，所以不做软删除。
 *    ⭐ 前端已经有一层二次确认（`detail.js` 的 `window.confirm`）。
 *
 * ⚠️ 先查再删，**不是多此一举**：
 *    · 要确认"这条存在**而且**属于当前用户" —— 否则会变成"能删别人的数据"
 *    · 而且**删之前得把这条读出来** —— ⭐ 前端要拿它的 `images`
 *      去云存储里删照片（不删就留下孤儿文件）
 *
 * @param {string} id
 * @param {string} ownerId
 * @returns {Promise<{ok:boolean, deleted?:number, place?:object, reason?:string}>}
 *          ⭐ `place` 是被删掉的那条（供前端清理云存储用）
 */
async function deletePlace(id, ownerId) {
  const found = await db.collection(COLLECTION)
    .where({ _id: id, ownerId: ownerId })
    .limit(1)
    .get();

  const doc = (found.data || [])[0];
  if (!doc) return { ok: false, reason: 'not_found' };

  const res = await db.collection(COLLECTION).doc(id).remove();
  const deleted = (res && typeof res.deleted === 'number') ? res.deleted : 1;

  return { ok: true, deleted: deleted, place: toApiPlace(doc) };
}

/**
 * ⭐ 数条数 + 取第一条（给 `/api/db-check` 那个临时接口用）
 * @returns {Promise<{count:number, first:object|null}>} first 是**原始文档**
 */
async function countAll() {
  const result = await db.collection(COLLECTION).get();
  const list = result.data || [];
  /* ⭐ 补上接口形状的字段，让 db-check 拿到的也是干净的对象 */
  return {
    count: list.length,
    first: list[0] ? toApiPlace(list[0]) : null,
  };
}

module.exports = {
  VALID_PLACE_TYPES: VALID_PLACE_TYPES,
  toApiPlace: toApiPlace,
  newPlaceId: newPlaceId,
  findPlaces: findPlaces,
  findPlaceById: findPlaceById,
  findExistingAtCoordinate: findExistingAtCoordinate,
  updatePlace: updatePlace,
  deletePlace: deletePlace,
  insertPlace: insertPlace,
  countAll: countAll,
};
