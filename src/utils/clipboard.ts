// Put text on the clipboard: the Clipboard API, else (an older iPhone, a page
// not served over https) a hidden textarea and execCommand('copy').
// Resolves true when the text was copied.
export const copyText = async (text: string): Promise<boolean> => {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // fall through to the textarea
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', width: '2em', height: '2em', padding: '0', border: 'none', outline: 'none', boxShadow: 'none', background: 'transparent', opacity: '0.01' });
    document.body.appendChild(ta);
    try {
        if (/ipad|iphone/i.test(navigator.userAgent)) {
            ta.contentEditable = 'true';
            ta.readOnly = false;
            const range = document.createRange();
            range.selectNodeContents(ta);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        } else {
            ta.focus();
        }
        ta.select();
        ta.setSelectionRange(0, text.length);
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        document.body.removeChild(ta);
    }
};
