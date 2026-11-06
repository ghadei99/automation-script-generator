const names = { notebook: 'Notebook', pen: 'Pen' };
const name = names[new URLSearchParams(location.search).get('sku')] || 'Unknown item';
document.querySelector('[data-testid="product-name"]').textContent = name;
document.querySelector('[data-testid="add-cart"]').addEventListener('click', () => {
  const cart = document.querySelector('[data-testid="cart"]');
  cart.hidden = false;
  cart.textContent = `${name} is in the cart`;
});
