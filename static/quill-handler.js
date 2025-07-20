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
    function initializeEditor(editorId, hiddenInput) {
        const quill = new Quill(`#${editorId}`, {
            theme: 'snow',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline'],
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                    ['link'],
                    ['clean']
                ]
            },
            formats: ['bold', 'italic', 'underline', 'strike', 'blockquote', 'header', 'list', 'link', 'highlight', 'note', 'divider'],
        });

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