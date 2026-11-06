document.querySelector('[data-testid="load-profile"]').addEventListener('click', async () => {
  const response = await fetch('/api/profile');
  const body = await response.json();
  document.querySelector('[data-testid="profile"]').textContent = body.name;
});
