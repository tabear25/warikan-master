// 描画前にテーマクラスを適用して、ダークモード時のちらつき（FOUC）を防ぐ。
// CSP で scriptSrc 'self' を成立させるためインラインではなく外部ファイルにしている
// （同期スクリプトなので first paint 前に必ず実行される）。
(function () {
  try {
    var stored = localStorage.getItem("warikan-theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
