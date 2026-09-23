class Todo < ApplicationRecord
  normalizes :text, with: ->(text) { text.strip }

  validates :text, presence: true
  validates :completed, inclusion: { in: [ true, false ] }
end
