const signupForm = document.getElementById('launch-form');
signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!signupForm.reportValidity()) return;
  const button = signupForm.querySelector('button');
  const status = document.getElementById('signup-status');
  button.disabled = true;
  button.textContent = 'Saving…';
  status.textContent = '';
  try {
    const response = await fetch('/api/subscribe', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(signupForm)))});
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to save your email. Please try again.');
    status.textContent = result.message;
    status.dataset.state = 'success';
    signupForm.reset();
  } catch (error) {
    status.textContent = error instanceof TypeError ? 'Unable to connect. Please try again.' : error.message;
    status.dataset.state = 'error';
  } finally { button.disabled = false; button.textContent = 'Notify me at launch'; }
});
