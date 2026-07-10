import './ConfirmDialog.css'

export interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  buttons: {
    label: string
    variant?: 'primary' | 'danger' | 'secondary'
    onClick: () => void
  }[]
}

function ConfirmDialog({ isOpen, title, message, buttons }: ConfirmDialogProps) {
  if (!isOpen) return null

  return (
    <div className="confirm-dialog-overlay">
      <div className="confirm-dialog">
        <div className="confirm-dialog-title">{title}</div>
        <div className="confirm-dialog-message">{message}</div>
        <div className="confirm-dialog-buttons">
          {buttons.map((button, index) => (
            <button
              key={index}
              className={`confirm-dialog-button ${button.variant || 'secondary'}`}
              onClick={button.onClick}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
