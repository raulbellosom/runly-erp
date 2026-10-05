import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  forwardRef,
} from "react";
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  codeBlockPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  StrikeThroughSupSubToggles,
  CodeToggle,
  BlockTypeSelect,
  ListsToggle,
  CreateLink,
  InsertTable,
  InsertThematicBreak,
  InsertCodeBlock,
  Separator,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { cn } from "../lib/utils.js";
import { FieldWrapper } from "./form-field-base.jsx";

// Shared Spanish defaults. Consumers may override MDXEditor's translation
// callback without replacing the toolbar or changing Markdown serialization.
const EDITOR_ES = {
  'toolbar.blockTypes.paragraph': 'Párrafo', 'toolbar.blockTypes.quote': 'Cita',
  'toolbar.blockTypes.heading': 'Encabezado {{level}}',
  'toolbar.blockTypeSelect.selectBlockTypeTooltip': 'Seleccionar tipo de bloque',
  'toolbar.blockTypeSelect.placeholder': 'Tipo de bloque',
  'toolbar.bold': 'Negrita', 'toolbar.removeBold': 'Quitar negrita',
  'toolbar.italic': 'Cursiva', 'toolbar.removeItalic': 'Quitar cursiva',
  'toolbar.underline': 'Subrayado', 'toolbar.removeUnderline': 'Quitar subrayado',
  'toolbar.strikethrough': 'Tachado', 'toolbar.removeStrikethrough': 'Quitar tachado',
  'toolbar.superscript': 'Superíndice', 'toolbar.removeSuperscript': 'Quitar superíndice',
  'toolbar.subscript': 'Subíndice', 'toolbar.removeSubscript': 'Quitar subíndice',
  'toolbar.inlineCode': 'Código en línea', 'toolbar.removeInlineCode': 'Quitar formato de código',
  'toolbar.link': 'Crear enlace', 'toolbar.table': 'Insertar tabla',
  'toolbar.thematicBreak': 'Insertar separador', 'toolbar.codeBlock': 'Insertar bloque de código',
  'toolbar.bulletedList': 'Lista con viñetas', 'toolbar.numberedList': 'Lista numerada',
  'toolbar.checkList': 'Lista de tareas', 'toolbar.undo': 'Deshacer {{shortcut}}',
  'toolbar.redo': 'Rehacer {{shortcut}}', 'toolbar.toggleGroup': 'Grupo de formato',
  'codeBlock.language': 'Lenguaje del bloque de código', 'codeBlock.selectLanguage': 'Seleccionar lenguaje',
  'dialog.close': 'Cerrar diálogo', 'dialogControls.save': 'Guardar', 'dialogControls.cancel': 'Cancelar',
  'createLink.url': 'URL', 'createLink.urlPlaceholder': 'Selecciona o pega una URL',
  'createLink.text': 'Texto del enlace', 'createLink.textTooltip': 'Texto que se mostrará en el enlace',
  'createLink.title': 'Título del enlace', 'createLink.titleTooltip': 'Título que aparece al pasar el cursor',
  'createLink.saveTooltip': 'Guardar URL', 'createLink.cancelTooltip': 'Cancelar cambio',
  'linkPreview.edit': 'Editar URL del enlace', 'linkPreview.copyToClipboard': 'Copiar al portapapeles',
  'linkPreview.copied': '¡Copiado!', 'linkPreview.remove': 'Quitar enlace',
};
function translateMarkdownEditor(key, fallback, values = {}) {
  return (EDITOR_ES[key] ?? fallback).replace(/{{(\w+)}}/g, (match, name) => values[name] === undefined ? match : String(values[name]));
}

function EditorToolbar() {
  return (
    <>
      <UndoRedo />
      <Separator />
      <BlockTypeSelect />
      <Separator />
      <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
      <StrikeThroughSupSubToggles options={["Strikethrough"]} />
      <CodeToggle />
      <Separator />
      <ListsToggle />
      <Separator />
      <CreateLink />
      <InsertTable />
      <InsertThematicBreak />
      <InsertCodeBlock />
    </>
  );
}

const PLUGINS = [
  headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }),
  listsPlugin(),
  quotePlugin(),
  thematicBreakPlugin(),
  linkPlugin(),
  linkDialogPlugin(),
  tablePlugin(),
  codeBlockPlugin({ defaultCodeBlockLanguage: "" }),
  markdownShortcutPlugin(),
];

const PLUGINS_WITH_TOOLBAR = [
  ...PLUGINS,
  toolbarPlugin({ toolbarContents: () => <EditorToolbar /> }),
];

export const MarkdownField = forwardRef(function MarkdownField(
  {
    label,
    error,
    hint,
    required,
    id,
    value,
    onChange,
    onBlur,
    maxLength = 5000,
    placeholder = "Escribe tus observaciones aquí...",
    disabled,
    readOnly,
    readOnlyPlain = false,
    className,
    translation = translateMarkdownEditor,
  },
  _ref,
) {
  const editorRef = useRef(null);
  const containerRef = useRef(null);
  const lastPushed = useRef(value ?? "");
  const [charCount, setCharCount] = useState((value ?? "").length);

  // MDXEditor (via its internal Radix Select for BlockTypeSelect) sets aria-hidden
  // on its popup container while a focused descendant is inside it, triggering a
  // browser accessibility warning. We intercept setAttribute synchronously on the
  // popup container element so the attribute is never written in the first place.
  // useLayoutEffect runs after children mount (bottom-up), so MDXEditor's popup
  // container already exists in the DOM when this runs.
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    function patchPopupContainer(el) {
      if (el._ariaHiddenPatched) return;
      el._ariaHiddenPatched = true;
      const origSetAttr = el.setAttribute.bind(el);
      el.setAttribute = function (name, value) {
        if (name === "aria-hidden") return;
        return origSetAttr(name, value);
      };
    }

    // Patch popup containers already in the DOM (MDXEditor creates them on mount).
    root
      .querySelectorAll(".mdxeditor-popup-container")
      .forEach(patchPopupContainer);

    // Watch for popup containers added lazily (e.g. link dialog portal).
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            if (node.classList.contains("mdxeditor-popup-container"))
              patchPopupContainer(node);
            node
              .querySelectorAll?.(".mdxeditor-popup-container")
              .forEach(patchPopupContainer);
          }
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Sync external value (e.g. form reset or initial load after data fetch)
  useEffect(() => {
    const incoming = value ?? "";
    if (incoming !== lastPushed.current && editorRef.current) {
      lastPushed.current = incoming;
      editorRef.current.setMarkdown(incoming);
      setCharCount(incoming.length);
    }
  }, [value]);

  function handleChange(md, isInitialNormalize) {
    if (isInitialNormalize) return;
    lastPushed.current = md;
    setCharCount(md.length);
    onChange?.({ target: { value: md } });
  }

  const isReadOnly = readOnly || disabled;

  if (readOnlyPlain || (readOnly && readOnlyPlain)) {
    return (
      <FieldWrapper
        label={label}
        labelFor={id}
        error={error}
        hint={hint}
        required={required}
      >
        <MDXEditor
          ref={editorRef}
          translation={translation}
          markdown={value ?? ""}
          readOnly
          plugins={PLUGINS}
          contentEditableClassName="mdx-prose"
          className={cn("mdx-viewer-plain", className)}
        />
      </FieldWrapper>
    );
  }

  return (
    <FieldWrapper
      label={label}
      labelFor={id}
      error={error}
      hint={hint}
      required={required}
      className={className}
    >
      <div
        ref={containerRef}
        className={cn(
          "rounded-lg border bg-card overflow-hidden transition-colors",
          error ? "border-destructive" : "border-border",
          !isReadOnly &&
            "focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary",
          disabled && "opacity-60 cursor-not-allowed pointer-events-none",
        )}
      >
        <MDXEditor
          ref={editorRef}
          translation={translation}
          markdown={value ?? ""}
          onChange={handleChange}
          onBlur={() => onBlur?.()}
          readOnly={isReadOnly}
          placeholder={placeholder}
          plugins={isReadOnly ? PLUGINS : PLUGINS_WITH_TOOLBAR}
          contentEditableClassName="mdx-prose"
          className="mdx-editor-root"
        />
      </div>
      {maxLength && !isReadOnly && (
        <p className="text-right text-[11px] text-muted-foreground -mt-0.5">
          {charCount} / {maxLength}
        </p>
      )}
    </FieldWrapper>
  );
});
