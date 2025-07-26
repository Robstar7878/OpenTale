/**
 * OpenTale - Common JS functions
 */

// Check if document is ready
document.addEventListener('DOMContentLoaded', function() {
    // Enable Bootstrap tooltips
    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    var tooltipList = tooltipTriggerList.map(function(tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });

    // Auto-resize textareas
    document.querySelectorAll('textarea.auto-resize').forEach(function(textarea) {
        textarea.addEventListener('input', autoResizeTextarea);
        // Initial resize
        autoResizeTextarea.call(textarea);
    });

    // Handle active navigation links
    highlightActiveNav();

    // Handle chapter pagination
    handleChapterPagination();
});

/**
 * Auto-resize a textarea based on its content
 */
function autoResizeTextarea() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
}

/**
 * Highlight the active navigation link based on the current page
 */
function highlightActiveNav() {
    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-link').forEach(function(link) {
        if (link.getAttribute('href') === currentPath) {
            link.classList.add('active');
        }
    });
}

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - The type of notification (success, error, warning, info)
 */
function showNotification(message, type = 'info') {
    // Create toast element if it doesn't exist
    let toastContainer = document.querySelector('.toast-container');
    
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(toastContainer);
    }
    
    // Create the toast
    const toastId = 'toast-' + Date.now();
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white bg-${type} border-0`;
    toast.id = toastId;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                ${message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    // Show the toast
    const bsToast = new bootstrap.Toast(toast, {
        animation: true,
        autohide: true,
        delay: 3000
    });
    
    bsToast.show();
    
    // Remove the toast after it's hidden
    toast.addEventListener('hidden.bs.toast', function() {
        toast.remove();
    });
}

/**
 * Copy text to clipboard
 * @param {string} text - The text to copy
 * @returns {boolean} - Whether the copy was successful
 */
async function copyToClipboard(text) {
    if (!navigator.clipboard) {
        showNotification('Clipboard API not available', 'error');
        return false;
    }
    try {
        await navigator.clipboard.writeText(text);
        showNotification('Copied to clipboard!', 'success');
        return true;
    } catch (err) {
        console.error('Failed to copy text: ', err);
        showNotification('Failed to copy to clipboard', 'error');
        return false;
    }
}

/**
 * Save form data to local storage
 * @param {string} formId - The ID of the form to save
 * @param {string} storageKey - The key to use in localStorage
 */
function saveFormToLocalStorage(formId, storageKey) {
    const form = document.getElementById(formId);
    if (!form) return;
    
    const formData = {};
    const formElements = form.elements;
    
    for (let i = 0; i < formElements.length; i++) {
        const element = formElements[i];
        if (element.name && element.type !== 'submit' && element.type !== 'button') {
            formData[element.name] = element.value;
        }
    }
    
    localStorage.setItem(storageKey, JSON.stringify(formData));
}

/**
 * Load form data from local storage
 * @param {string} formId - The ID of the form to populate
 * @param {string} storageKey - The key to use in localStorage
 */
function loadFormFromLocalStorage(formId, storageKey) {
    const savedData = localStorage.getItem(storageKey);
    if (!savedData) return;
    
    const form = document.getElementById(formId);
    if (!form) return;
    
    const formData = JSON.parse(savedData);
    const formElements = form.elements;
    
    for (let i = 0; i < formElements.length; i++) {
        const element = formElements[i];
        if (element.name && formData[element.name] !== undefined) {
            element.value = formData[element.name];
        }
    }
} 


/**
 * Handle chapter navigation pagination
 */
function handleChapterPagination() {
    const chaptersPerPageSelect = document.getElementById('chaptersPerPage');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const firstChapterBtn = document.getElementById('firstChapterBtn');
    const lastChapterBtn = document.getElementById('lastChapterBtn');
    const chapterNavContainer = document.querySelector('.list-group[data-total-chapters]');

    if (!chaptersPerPageSelect && !prevPageBtn && !nextPageBtn && !firstChapterBtn && !lastChapterBtn) {
        return; // Exit if no pagination controls are on this page
    }

    const url = new URL(window.location.href);
    const currentPage = parseInt(url.searchParams.get('page') || '1', 10);
    const perPage = parseInt(url.searchParams.get('per_page') || '10', 10);

    if (chaptersPerPageSelect) {
        chaptersPerPageSelect.value = perPage;
        chaptersPerPageSelect.addEventListener('change', (e) => {
            const newPerPage = e.target.value;
            url.searchParams.set('per_page', newPerPage);
            url.searchParams.set('page', '1'); // Reset to first page
            window.location.href = url.toString();
        });
    }

    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                url.searchParams.set('page', currentPage - 1);
                window.location.href = url.toString();
            }
        });
    }

    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            url.searchParams.set('page', currentPage + 1);
            window.location.href = url.toString();
        });
    }

    const updateChapterView = (newChapterNumber) => {
        const currentPath = window.location.pathname;
        const pathParts = currentPath.split('/').filter(p => p); // filter out empty strings
        if (pathParts.length >= 2) {
            const view = pathParts[0];
            url.pathname = `/${view}/${newChapterNumber}`;
            window.location.href = url.toString();
        }
    };

    if (firstChapterBtn) {
        firstChapterBtn.addEventListener('click', () => {
            url.searchParams.set('page', '1');
            updateChapterView(1);
        });
    }

    if (lastChapterBtn && chapterNavContainer) {
        lastChapterBtn.addEventListener('click', () => {
            const totalChapters = parseInt(chapterNavContainer.dataset.totalChapters, 10);
            if (totalChapters) {
                const totalPages = Math.ceil(totalChapters / perPage);
                url.searchParams.set('page', totalPages);
                updateChapterView(totalChapters);
            }
        });
    }
}

/**
 * Shows a Bootstrap modal with a title and pre-formatted content.
 * @param {string} title The title of the modal.
 * @param {string} content The pre-formatted content to display.
 */
function showModalWithContent(title, content) {
    // Remove any existing modals
    const existingModal = document.getElementById('dynamicModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Create modal elements
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = 'dynamicModal';
    modal.tabIndex = -1;
    modal.innerHTML = `
        <div class="modal-dialog modal-xl modal-fullscreen-lg-down">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">${title}</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body modal-body-scrollable">
                    <div class="d-flex justify-content-end">
                        <button type="button" class="btn btn-link btn-sm copy-icon" id="copyModalContent" data-bs-toggle="tooltip" data-bs-placement="bottom" title="Copy to Clipboard">
                            <i class="bi bi-clipboard"></i>
                        </button>
                    </div>
                    <pre><code id="modalContent">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const bsModal = new bootstrap.Modal(modal);

    // Handle copy button clicks
    document.getElementById('copyModalContent').addEventListener('click', function() {
        copyToClipboard(content);
    });

    // Initialize tooltips within the new modal
    const tooltipTriggerList = [].slice.call(modal.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });

    // Clean up after modal is hidden
    modal.addEventListener('hidden.bs.modal', function() {
        modal.remove();
    });

    bsModal.show();
}

/**
 * Shows a Bootstrap modal with two tabs, each containing pre-formatted content and a copy-to-clipboard button.
 * @param {string} title The title of the modal.
 * @param {string} tab1Title The title of the first tab.
 * @param {string} tab1Content The pre-formatted content for the first tab.
 * @param {string} tab2Title The title of the second tab.
 * @param {string} tab2Content The pre-formatted content for the second tab.
 */
function showDualContentModal(title, tab1Title, tab1Content, tab2Title, tab2Content) {
    // Remove any existing modals
    const existingModal = document.getElementById('dualContentModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Create modal elements
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = 'dualContentModal';
    modal.tabIndex = -1;
    modal.style.zIndex = 1050; /* Ensure modal is on top */
    modal.innerHTML = `
        <div class="modal-dialog modal-xl modal-fullscreen-lg-down">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">${title}</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body modal-body-scrollable">
                    <ul class="nav nav-tabs" id="myTab" role="tablist">
                        <li class="nav-item" role="presentation">
                            <button class="nav-link active" id="tab1-tab" data-bs-toggle="tab" data-bs-target="#tab1-pane" type="button" role="tab" aria-controls="tab1-pane" aria-selected="true">${tab1Title}</button>
                        </li>
                        <li class="nav-item" role="presentation">
                            <button class="nav-link" id="tab2-tab" data-bs-toggle="tab" data-bs-target="#tab2-pane" type="button" role="tab" aria-controls="tab2-pane" aria-selected="false">${tab2Title}</button>
                        </li>
                    </ul>
                    <div class="tab-content" id="myTabContent">
                        <div class="tab-pane fade show active" id="tab1-pane" role="tabpanel" aria-labelledby="tab1-tab" tabindex="0">
                            <div class="d-flex justify-content-end mt-2">
                                <button type="button" class="btn btn-link btn-sm copy-icon" id="copyTab1Content" data-bs-toggle="tooltip" data-bs-placement="bottom" title="Copy to Clipboard">
                                    <i class="bi bi-clipboard"></i>
                                </button>
                            </div>
                            <pre><code id="tab1Content">${tab1Content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
                        </div>
                        <div class="tab-pane fade" id="tab2-pane" role="tabpanel" aria-labelledby="tab2-tab" tabindex="0">
                            <div class="d-flex justify-content-end mt-2">
                                <button type="button" class="btn btn-link btn-sm copy-icon" id="copyTab2Content" data-bs-toggle="tooltip" data-bs-placement="bottom" title="Copy to Clipboard">
                                    <i class="bi bi-clipboard"></i>
                                </button>
                            </div>
                            <pre><code id="tab2Content">${tab2Content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const bsModal = new bootstrap.Modal(modal);

    // Handle copy button clicks
    document.getElementById('copyTab1Content').addEventListener('click', function() {
        copyToClipboard(tab1Content);
    });
    document.getElementById('copyTab2Content').addEventListener('click', function() {
        copyToClipboard(tab2Content);
    });

    // Clean up after modal is hidden
    modal.addEventListener('hidden.bs.modal', function() {
        modal.remove();
    });

    bsModal.show();
}
