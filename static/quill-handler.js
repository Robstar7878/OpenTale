$(document).ready(function() {
    // Initialize converters
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        bulletListMarker: '-',
        emDelimiter: '*',
        strongDelimiter: '**',
        hr: '* * *',
        codeBlockStyle: 'fenced'
    });
    const showdownConverter = new showdown.Converter({
        tables: false,
        strikethrough: false,
        tasklists: false,
        simplifiedAutoLink: true
    });

    const Inline = Quill.import('blots/inline');
    const BlockEmbed = Quill.import('blots/block/embed');

    // 1. Define Custom Blots
    // HighlightBlot: <mark class="highlight-text">
    class HighlightBlot extends Inline {}
    HighlightBlot.blotName = 'highlight';
    HighlightBlot.tagName = 'mark';
    HighlightBlot.className = 'highlight-text';

    // NoteBlot: <mark>
    class NoteBlot extends Inline {}
    NoteBlot.blotName = 'note';
    NoteBlot.tagName = 'mark';

    // DividerBlot: <hr>
    class DividerBlot extends BlockEmbed {}
    DividerBlot.blotName = 'divider';
    DividerBlot.tagName = 'hr';

    // Register the custom blots with Quill
    Quill.register(HighlightBlot);
    Quill.register(NoteBlot);
    Quill.register(DividerBlot);

    // 2. Add cleaning methods
    /**
     * Removes all 'mark' tag formatting (highlights and notes) but keeps the text.
     * @param {Quill} quill The Quill instance.
     */
    window.cleanEditorMarks = function(quill) {
        const delta = quill.getContents();
        const newOps = delta.ops.map(op => {
            if (op.attributes && (op.attributes.highlight || op.attributes.note)) {
                const { highlight, note, ...rest } = op.attributes;
                op.attributes = Object.keys(rest).length > 0 ? rest : undefined;
            }
            return op;
        });
        quill.setContents(newOps, 'api');
    };

    /**
     * Removes all 'mark' tags and the content within them.
     * @param {Quill} quill The Quill instance.
     */
    window.cleanEditorMarksAndContent = function(quill) {
        const delta = quill.getContents();
        const newOps = delta.ops.filter(op =>
            !op.attributes || (!op.attributes.highlight && !op.attributes.note)
        );
        quill.setContents(newOps, 'api');
    };

    /**
     * Updates the hidden input with the current editor content in Markdown.
     * @param {Quill} quill The Quill instance.
     */
    window.updateHiddenInput = function(quill) {
        const editorId = quill.container.id;
        const hiddenInput = $(`#${editorId}-hidden`);
        const semanticHTML = quill.getSemanticHTML().replace(/(\u00A0|&nbsp;)/g, ' ');
        hiddenInput.val(turndownService.turndown(semanticHTML));
    };

    /**
     * Initializes a Quill editor with custom blots.
     * @param {string} editorId The ID of the editor container.
     * @param {jQuery} hiddenInput The jQuery object for the hidden input field.
     * @returns {Quill} The initialized Quill instance.
     */
    // Define custom icons
    const icons = Quill.import('ui/icons');
    icons['divider'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    icons['showHtml'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>';
    icons['showMarkdown'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM9.5 16.5H7.5v-6h2v6zm4-6h-2v6h2v-2.5l2 2.5v-6l-2 2.5V10.5z"/></svg>';
    icons['increaseFontSize'] = '<svg viewBox="0 0 18 18"><line class="ql-stroke" x1="9" y1="5" x2="9" y2="13"></line><line class="ql-stroke" x1="5" y1="9" x2="13" y2="9"></line></svg>';
    icons['decreaseFontSize'] = '<svg viewBox="0 0 18 18"><line class="ql-stroke" x1="5" y1="9" x2="13" y2="9"></line></svg>';

    function initializeEditor(editorId, hiddenInput) {
        const FONT_SIZE_KEY = 'quill-font-size';
        const MIN_FONT_SIZE = 10;
        const MAX_FONT_SIZE = 30;
        const FONT_STEP = 1;

        const quill = new Quill(`#${editorId}`, {
            theme: 'snow',
            modules: {
                toolbar: {
                    container: [
                        [{ 'header': [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        ['divider'],
                        ['showHtml', 'showMarkdown'],
                        ['increaseFontSize', 'decreaseFontSize'],
                        ['clean']
                    ],
                    handlers: {
                        'divider': function() {
                            const range = this.quill.getSelection(true);
                            this.quill.insertEmbed(range.index, 'divider', true, 'user');
                            this.quill.setSelection(range.index + 1, 0, 'user');
                        },
                        'showHtml': function() {
                            let html = this.quill.getSemanticHTML().replace(/(\u00A0|&nbsp;)/g, ' ');
                            html = html.replace(/<(p|h1|h2|h3|ol|ul|li|blockquote|pre|hr)/g, '\n<$1').trim();
                            showModalWithContent('Raw HTML', html);
                        },
                        'showMarkdown': function() {
                            const markdown = hiddenInput.val();
                            showModalWithContent('Markdown', markdown);
                        },
                        'increaseFontSize': function() {
                            const editor = this.quill.container.querySelector('.ql-editor');
                            let currentSize = parseInt(window.getComputedStyle(editor).getPropertyValue('--quill-font-size'), 10) || 16;
                            if (currentSize < MAX_FONT_SIZE) {
                                const newSize = currentSize + FONT_STEP;
                                editor.style.setProperty('--quill-font-size', `${newSize}px`);
                                localStorage.setItem(FONT_SIZE_KEY, newSize);
                            }
                        },
                        'decreaseFontSize': function() {
                            const editor = this.quill.container.querySelector('.ql-editor');
                            let currentSize = parseInt(window.getComputedStyle(editor).getPropertyValue('--quill-font-size'), 10) || 16;
                            if (currentSize > MIN_FONT_SIZE) {
                                const newSize = currentSize - FONT_STEP;
                                editor.style.setProperty('--quill-font-size', `${newSize}px`);
                                localStorage.setItem(FONT_SIZE_KEY, newSize);
                            }
                        }
                    }
                }
            },
            formats: ['bold', 'italic', 'underline', 'strike', 'blockquote', 'header', 'list', 'link', 'highlight', 'note', 'divider'],
        });

        // Load saved font size
        const savedSize = localStorage.getItem(FONT_SIZE_KEY);
        if (savedSize) {
            quill.container.querySelector('.ql-editor').style.setProperty('--quill-font-size', `${savedSize}px`);
        }

        // Load initial content from the data attribute
        const initialContentJSON = hiddenInput.data('initial-content');
        if (initialContentJSON) {
            try {
                // The content is passed as a JSON string (potentially Markdown), so parse it.
                const markdownContent = JSON.parse(initialContentJSON);
                // Convert Markdown to HTML
                const html = showdownConverter.makeHtml(markdownContent);
                // Load the converted HTML into Quill
                quill.clipboard.dangerouslyPasteHTML(html);
            } catch (e) {
                console.error('Error parsing or converting initial content for Quill editor:', e);
                // Fallback to raw content if parsing fails
                quill.clipboard.dangerouslyPasteHTML(initialContentJSON);
            }
        }

        // **Crucially, set the hidden input's value immediately after initialization**
        // This ensures that if the user saves without making changes, the original content is preserved.
        window.updateHiddenInput(quill);

        // Update hidden input whenever the user makes a change
        quill.on('text-change', function(delta, oldDelta, source) {
            if (source === 'user') {
                window.updateHiddenInput(quill);
            }
        });
        
        return quill;
    }

    // Find all Quill editor containers and initialize them
    $('.quill-editor').each(function() {
        const editorId = $(this).attr('id');
        const hiddenInput = $(`#${editorId}-hidden`);
        const quill = initializeEditor(editorId, hiddenInput);

        // Store the Quill instance in the element for later use
        $(this).data('quill', quill);
    });
});