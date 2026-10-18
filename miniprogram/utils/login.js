/**
 * 静默登录：只拿 code，不涉及任何用户信息授权，不会弹窗。
 */
function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (res && res.code) resolve(res.code)
        else reject(new Error('登录凭证获取失败'))
      },
      fail() {
        reject(new Error('登录失败'))
      }
    })
  })
}

module.exports = { wxLogin }
