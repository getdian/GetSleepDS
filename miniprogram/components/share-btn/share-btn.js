/**
 * 页内分享入口。
 * 微信只允许通过 button open-type="share" 主动调起转发；
 * 文案由宿主页面的 onShareAppMessage 根据当前场景动态生成。
 */
Component({
  properties: {
    text: {
      type: String,
      value: '分享'
    },
    variant: {
      type: String,
      value: 'ghost'
    }
  }
})
