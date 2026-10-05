/* ============================================================
   usersRepository.js —— users 集合的「数据访问层」（Day 19 新增）
   ============================================================
   ⭐ 只管"怎么读写 users 集合"。
   ⚠️ 看不到 `req` / `res` / 状态码。

   ⚠️ 现在只有 `countAll()` —— 因为**全项目只有 `/api/db-check` 用到 users**。
       ⭐ 之所以还是给它建一个独立文件（而不是塞给别的 repository）：
         · 它是一张独立的集合，将来 Day 20 加登录时**必然要在这儿加查询**；
         · ⚠️ 但**今天不提前写**（清单要求"不新增任何功能"）——
           等真要用时再加，那时只需动这一个文件。
   ============================================================ */

const dbModule = require('../cloudbase');
const db = dbModule.db;

/* ⚠️ 集合名只在这里出现 */
const COLLECTION = 'users';

/**
 * ⭐ 数条数（给 `/api/db-check` 那个临时接口用）
 * @returns {Promise<number>}
 */
async function countAll() {
  const result = await db.collection(COLLECTION).get();
  return (result.data || []).length;
}

module.exports = {
  countAll: countAll,
};
