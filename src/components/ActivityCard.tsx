import { ProgressBar, Spinner, describeOperation } from './ui'
import type { ActiveOperation } from '../types'

interface Props {
  operation: ActiveOperation
  onClick: () => void
}

/** Floating progress card shown on pages that don't display the task themselves */
export function ActivityCard({ operation, onClick }: Props) {
  const { item, percentText } = describeOperation(operation)
  return (
    <button className="activity-card" onClick={onClick} title="Show on the Play screen">
      <div className="activity-top">
        <Spinner size={13} />
        <span className="activity-title">{operation.title}</span>
        <span className="activity-pct">{percentText}</span>
      </div>
      <ProgressBar percent={operation.overallPercent} indeterminate={operation.indeterminate} />
      {item && <div className="activity-item">{item}</div>}
    </button>
  )
}
