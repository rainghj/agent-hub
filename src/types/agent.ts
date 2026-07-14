export interface AgentProfile {
  id: string
  name: string
  command: string
  args_template: string[]
  data_dir: string
  parser: string
  icon_color?: string
}
