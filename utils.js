
window.bootstrapConfirm = function(message) {
  return new Promise(resolve => {
    const modalHtml = `
      <div class="modal fade" id="bootstrapConfirmModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content border-danger">
            <div class="modal-header bg-danger text-white">
              <h5 class="modal-title"><i class="bi bi-exclamation-triangle-fill me-2"></i>Confirmar acción</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              ${message}
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" id="btnConfirmCancel">Cancelar</button>
              <button type="button" class="btn btn-danger" id="btnConfirmOk">Eliminar</button>
            </div>
          </div>
        </div>
      </div>
    `;
    let modalEl = document.getElementById('bootstrapConfirmModal');
    if (modalEl) modalEl.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    modalEl = document.getElementById('bootstrapConfirmModal');
    
    // eslint-disable-next-line no-undef
    const bsModal = new bootstrap.Modal(modalEl);
    
    document.getElementById('btnConfirmOk').addEventListener('click', () => {
      bsModal.hide();
      resolve(true);
    });
    
    modalEl.addEventListener('hidden.bs.modal', () => {
      resolve(false);
      modalEl.remove();
    });
    
    bsModal.show();
  });
};

// --- GLOBAL TOAST SYSTEM ---
function ensureToastContainer() {
  let container = document.getElementById('global-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'global-toast-container';
    document.body.appendChild(container);
  }
  return container;
}

window.showToast = function(type, message) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  
  // Icon mapping
  let iconClass = 'bi-info-circle-fill';
  if (type === 'success') iconClass = 'bi-check-circle-fill';
  else if (type === 'danger') iconClass = 'bi-exclamation-triangle-fill';
  else if (type === 'warning') iconClass = 'bi-exclamation-circle-fill';

  toast.className = `custom-toast ${type}`;
  toast.innerHTML = `
    <i class="bi ${iconClass} toast-icon"></i>
    <p class="toast-message">${message}</p>
  `;

  container.appendChild(toast);

  // Trigger entrance animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
  });

  // Remove after 3.5 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 300); // Wait for transition
  }, 3500);
};
