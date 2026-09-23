module ApplicationHelper
  # Links to the current page with some query parameters changed, and nil ones removed.
  # The replace action makes Turbo morph the page, so mounted widgets keep their state.
  def toggle_link(label, **changes)
    query = request.query_parameters.merge(changes.stringify_keys).compact.to_query
    link_to label, [ request.path, query.presence ].compact.join("?"), class: "button", data: { turbo_action: "replace" }
  end

  def next_color_scheme
    schemes = %w[ system light dark ]
    schemes[(schemes.index(color_scheme) + 1) % schemes.size]
  end
end
