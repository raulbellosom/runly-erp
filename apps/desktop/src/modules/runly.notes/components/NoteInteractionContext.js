import { createContext } from 'react'

// View mode is a UI preference, separate from the note's write permission.
export const NoteInteractionContext = createContext({ viewing: false })
