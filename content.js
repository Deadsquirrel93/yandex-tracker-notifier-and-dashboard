// Content script for Yandex Tracker Quote Feature

let quoteButton = null;

// Function to create SVG element securely without innerHTML
function createIconElement() {
    const svgNS = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(svgNS, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("fill", "none");
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", "M10 11H6V7H10V11ZM10 11H6C6 14 8 16 10 17V19C7.5 18 4 15.5 4 11V7C4 5.9 4.9 5 6 5H10C11.1 5 12 5.9 12 7V11ZM20 11H16V7H20V11ZM20 11H16C16 14 18 16 20 17V19C17.5 18 14 15.5 14 11V7C14 5.9 14.9 5 16 5H20C21.1 5 22 5.9 22 7V11Z");
    path.setAttribute("fill", "currentColor");
    icon.appendChild(path);
    return icon;
}

function createQuoteButton() {
    if (quoteButton) return quoteButton;

    quoteButton = document.createElement('button');
    quoteButton.className = 'yt-quote-btn';

    quoteButton.appendChild(createIconElement());
    quoteButton.appendChild(document.createTextNode(" Цитата"));

    quoteButton.addEventListener('mousedown', (e) => {
        // Prevent default to avoid clearing the selection before our click handler fires
        e.preventDefault();
    });

    quoteButton.addEventListener('click', handleQuoteClick);

    document.body.appendChild(quoteButton);
    return quoteButton;
}

function removeQuoteButton() {
    if (quoteButton) {
        quoteButton.remove();
        quoteButton = null;
    }
}

function handleSelection() {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (!text) {
        removeQuoteButton();
        return;
    }

    // Basic check: Ensure we are inside the main content area, roughly.
    // Tracker structure can vary, but usually we don't want to quote from the navbar.
    // Also explicitly ignore selections inside the editor itself.

    let activeNode = selection.anchorNode;
    if (activeNode && activeNode.nodeType === Node.TEXT_NODE) {
        activeNode = activeNode.parentNode;
    }

    if (activeNode && activeNode.closest) {
        const isInsideEditor = activeNode.closest('.ProseMirror, .cm-editor, .cm-content, textarea, input, .comment-editor');
        if (isInsideEditor) {
            removeQuoteButton();
            return;
        }
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Do not show if selection is invisible or backward
    if (rect.width === 0 || rect.height === 0) {
        removeQuoteButton();
        return;
    }

    const btn = createQuoteButton();

    // Position above the selection
    const btnHeight = 32; // Approx btn height
    let topPosition = rect.top + window.scrollY - btnHeight - 8;

    // If no space above, place below
    if (topPosition < window.scrollY) {
        topPosition = rect.bottom + window.scrollY + 8;
    }

    const leftPosition = rect.left + window.scrollX + (rect.width / 2) - (btn.offsetWidth / 2);

    btn.style.top = `${topPosition}px`;

    // Keep within horizontal bounds
    btn.style.left = `${Math.max(10, Math.min(leftPosition, document.documentElement.clientWidth - btn.offsetWidth - 10))}px`;
}

async function handleQuoteClick(e) {
    e.preventDefault();

    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (!text) return;

    // Format as a markdown blockquote (no trailing double newlines, just the quote)
    const quotedText = text.split('\n').map(line => `> ${line}`).join('\n') + '\n';

    // Try to find the comment input field
    // Yandex Tracker typically uses ProseMirror or CodeMirror for its rich text editor
    const proseMirrorEditors = document.querySelectorAll('.ProseMirror');
    const codeMirrorEditors = document.querySelectorAll('.cm-content[contenteditable="true"]');

    if (codeMirrorEditors.length > 0) {
        // CodeMirror 6 is used in the new Yandex Tracker markdown editor
        const editor = codeMirrorEditors[codeMirrorEditors.length - 1];
        editor.focus();

        // Simulate a paste event to correctly interact with CodeMirror 6 state 
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', quotedText);

        const pasteEvent = new ClipboardEvent('paste', {
            clipboardData: dataTransfer,
            bubbles: true,
            cancelable: true
        });

        editor.dispatchEvent(pasteEvent);

        // Scroll to the editor
        editor.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Force focus and move cursor to the end (often CodeMirror requires an extra click/focus after paste)
        setTimeout(() => {
            editor.focus();
        }, 50);

        // Clear selection and remove button
        window.getSelection().removeAllRanges();
        removeQuoteButton();
    } else if (proseMirrorEditors.length > 0) {
        // Get the last editor (usually the comment box at the bottom)
        const editor = proseMirrorEditors[proseMirrorEditors.length - 1];
        editor.focus();

        // Use document.execCommand to insert text, which interacts natively with ProseMirror
        document.execCommand('insertText', false, quotedText);

        // Scroll to the editor
        editor.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Clear selection and remove button
        window.getSelection().removeAllRanges();
        removeQuoteButton();
    } else {
        // Fallback if ProseMirror/CodeMirror is not found - let's try to find textarea
        const textarea = document.querySelector('textarea[name="comment"], textarea[placeholder*="комментарий" i], .comment-input textarea');

        if (textarea) {
            textarea.focus();
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;

            textarea.value = textarea.value.substring(0, start) + quotedText + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + quotedText.length;

            // Trigger input event to notify any framework relying on value changes
            textarea.dispatchEvent(new Event('input', { bubbles: true }));

            textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });

            window.getSelection().removeAllRanges();
            removeQuoteButton();
        } else {
            console.warn('Yandex Tracker Notifier: Could not find editor or textarea for commenting.');
            // Copy to clipboard as fallback
            try {
                await navigator.clipboard.writeText(quotedText);
                alert('Поле комментария не найдено. Цитата скопирована в буфер обмена!');
                window.getSelection().removeAllRanges();
                removeQuoteButton();
            } catch (err) {
                console.error('Failed to copy to clipboard: ', err);
            }
        }
    }
}

// Debounce the selection handler to avoid rapid unnecessary updates
let selectionTimeout;
document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimeout);

    const selection = window.getSelection();
    if (!selection.toString().trim()) {
        // Immediately remove if selection is cleared
        removeQuoteButton();
        return;
    }

    selectionTimeout = setTimeout(handleSelection, 150);
});

// Also handle mousedown specifically, so clicking elsewhere correctly removes it before the new selection
document.addEventListener('mousedown', (e) => {
    if (quoteButton && !quoteButton.contains(e.target)) {
        // Note: Don't remove immediately, because if they are starting a new selection,
        // selectionchange will fire. If they are just clicking, selectionchange won't fire
        // but the selection is maintained slightly. 
        // Wait a tick to see if selection was cleared
        setTimeout(() => {
            if (!window.getSelection().toString().trim()) {
                removeQuoteButton();
            }
        }, 10);
    }
});

// Remove on scroll to keep things clean and avoid calculating scroll diffs constantly
document.addEventListener('scroll', () => {
    removeQuoteButton();
}, { passive: true });
