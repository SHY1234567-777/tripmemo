/* ============================================================
   settingsRepository.js —— settings 集合的「数据访问层」（Day 19 新增）
   ============================================================
   ⭐ 只管"怎么读写 settings 集合"。
   ⚠️ 看不到 `req` / `res` / 状态码。

   ⚠️ 目前有三个方法：读设置 / **改设置（Day 23 新增）** / 数条数。
       ⭐ 原来只有"读"和"数"—— **写是缺的**，所以主城市存不下来
          （前端 `setMainCity` 只改了内存，**刷新就丢**，地图上一刷新连线全没）。
   ============================================================ */

const dbModule = require('../cloudbase');
const db = dbModule.db;

/* ⚠️ 集合名只在这里出现 */
const COLLECTION = 'settings';

/**
 * ⭐ 读某个用户的设置
 *
 * @param {string} ownerId
 * @returns {Promise<{mainCity: object|null, sampleLoaded: boolean}>}
 *          ⚠️ 即使这个用户还没有设置记录，也**返回默认值**（而不是 null）——
 *          因为契约 §四.6 要求响应里必须有这两个字段：
 *          `{ ok:true, mainCity, sampleLoaded }`
 *          ⭐ `mainCity` 允许是 `null`（用户还没设定主城市）——
 *            前端要能处理这种情况（地图上就没有连线起点）。
 */
async function getSettings(ownerId) {
  const result = await db.collection(COLLECTION)
    .where({ ownerId: ownerId })
    .limit(1)
    .get();

  const doc = (result.data || [])[0] || null;

  return {
    mainCity: (doc && doc.mainCity) ? doc.mainCity : null,
    sampleLoaded: doc ? !!doc.sampleLoaded : false,
  };
}

/**
 * ⭐ 改设置（Day 23 新增）
 *
 * ⭐ 语义：**部分更新** —— 只改请求体里"出现过"的字段。
 *
 * ⭐ 特殊情况：**upsert（没有就插一条）**——
 *    匿名用户第一次进来时**还没有 settings 记录**（种子数据里只有 `u_shy` 那几个），
 *    ⚠️ 所以不能只 update，没有就得新增。
 *
 * ⚠️ 为什么这个方法是"线的命根子"：地图上**所有连线都从主城市出发**，
 *    而主城市就存在这张表里。方法不做 = 主城市存不下来 = 一刷新连线全没。
 *
 * @param {string} ownerId
 * @param {object} patch 只放要改的字段（`mainCity` / `sampleLoaded`）
 * @returns {Promise<{mainCity: object|null, sampleLoaded: boolean}>} 改完之后的完整设置
 */
async function updateSettings(ownerId, patch) {
  const result = await db.collection(COLLECTION)
    .where({ ownerId: ownerId })
    .limit(1)
    .get();

  const doc = (result.data || [])[0] || null;

  /* ⚠️⚠️ 只挑"请求体里出现过"的字段，**绝对不能**写成 `if (patch.mainCity)`：
     那样传 `mainCity: null`（用户想清除锚点、让地图不画线）会被当成"没传" ——
     ⭐ 结果就是"永远清不掉主城市"。
     这是 Day 21 在 `/api/place` 上踩过的同一个坑，别再踩第三遍。 */
  const fields = {};
  if ('mainCity' in patch) fields.mainCity = patch.mainCity;
  if ('sampleLoaded' in patch) fields.sampleLoaded = !!patch.sampleLoaded;
  fields.updatedAt = new Date();

  if (doc) {
    await db.collection(COLLECTION).doc(doc._id).update(fields);
  } else {
    await db.collection(COLLECTION).add(Object.assign({
      _id: newSettingsId(),
      ownerId: ownerId,
    }, fields));
  }

  /* ⭐ 返回**改完之后**的完整设置 —— 让前端拿它回填（以服务端为准） */
  return await getSettings(ownerId);
}

/**
 * ⭐ 生成 settings 的 `_id`
 * ⚠️ 前缀用 `s_`，和种子数据（`s_shy` / `s_friend_01` …）保持同一个风格。
 */
function newSettingsId() {
  return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

/**
 * ⭐ 数条数（给 `/api/db-check` 那个临时接口用）
 * @returns {Promise<number>}
 */
async function countAll() {
  const result = await db.collection(COLLECTION).get();
  return (result.data || []).length;
}

module.exports = {
  getSettings: getSettings,
  updateSettings: updateSettings,
  countAll: countAll,
};
