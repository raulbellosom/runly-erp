import { Node, mergeAttributes } from '@tiptap/react'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ImageAnnotationOverlay } from '../../components/ImageAnnotationOverlay.jsx'

export const AnnotatableImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  // Reordering is handled with a custom pointer-based drag handle (see
  // ImageAnnotationOverlay) instead of native HTML5 drag, which doesn't
  // fire on touch devices.
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      annotations: { default: '[]' },
      // Percentage (0..100) of the content column. null = full width, for
      // backward compatibility with images inserted before this attribute
      // existed — new inserts get an explicit default (see noteImageUpload.js).
      width: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('data-width')
          if (!raw) return null
          const n = Number(raw)
          return Number.isFinite(n) ? n : null
        },
        renderHTML: (attrs) =>
          attrs.width != null ? { 'data-width': String(attrs.width) } : {},
      },
      crop: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('data-crop')
          if (!raw) return null
          try {
            return JSON.parse(raw)
          } catch {
            return null
          }
        },
        renderHTML: (attrs) =>
          attrs.crop ? { 'data-crop': JSON.stringify(attrs.crop) } : {},
      },
      // One of 0/90/180/270, clockwise. crop + annotations are always
      // stored in the ALREADY-ROTATED image's own fraction space (see
      // lib/imageCrop.js), so changing this alone is enough to redisplay
      // the image correctly everywhere it renders.
      rotation: {
        default: 0,
        parseHTML: (el) => {
          const raw = Number(el.getAttribute('data-rotation'))
          return raw === 90 || raw === 180 || raw === 270 ? raw : 0
        },
        renderHTML: (attrs) =>
          attrs.rotation ? { 'data-rotation': String(attrs.rotation) } : {},
      },
      // Set once the user free-resizes an image via a corner handle
      // (ImageAnnotationOverlay.jsx). null = derive the frame's aspect ratio
      // from the natural image size instead (current/default behavior).
      aspectRatio: {
        default: null,
        parseHTML: (el) => {
          const raw = Number(el.getAttribute('data-aspect-ratio'))
          return Number.isFinite(raw) && raw > 0 ? raw : null
        },
        renderHTML: (attrs) =>
          attrs.aspectRatio ? { 'data-aspect-ratio': String(attrs.aspectRatio) } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'img[src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageAnnotationOverlay)
  },
})
