const p = new URLSearchParams(location.search).get('error');
if (p) {
  const el = document.getElementById('err');
  el.textContent = p === 'locked' ? 'Too many attempts. Please wait 15 minutes and try again.' : 'Wrong email or password.';
  el.hidden = false;
}
