// onCloseAutoFocus for Dropdown/Context menus. When a menu item opens a
// Dialog/ConfirmDialog, by the time the menu closes the dialog has
// aria-hidden the rest of the page, so returning focus to the trigger would
// focus a hidden element (Chrome blocks it and logs "Blocked aria-hidden...").
// Focus is left to the dialog instead.
export function keepFocusInOpenDialog(onCloseAutoFocus) {
  return (event) => {
    onCloseAutoFocus?.(event)
    if (event.defaultPrevented) return
    if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) event.preventDefault()
  }
}
