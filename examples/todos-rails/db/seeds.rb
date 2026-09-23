[
  { text: "Write the launch announcement", completed: false },
  { text: "Review the open pull requests", completed: false },
  { text: "Book the offsite venue", completed: true }
].each { |attributes| Todo.find_or_create_by!(attributes) }
