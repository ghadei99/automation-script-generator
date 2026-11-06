const form = document.getElementById('login');
const error = document.getElementById('error');

function show(message) {
  error.hidden = false;
  error.textContent = message;
  error.className = 'error';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  if (!username) {
    show('Username is required');
    return;
  }
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json();
  if (!response.ok) {
    show(body.error || 'Invalid credentials');
    return;
  }
  window.location.href = '/app.html';
});
