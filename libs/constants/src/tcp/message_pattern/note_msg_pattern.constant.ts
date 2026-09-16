export const NOTE_MESSAGE_PATTERN = {
  // pages
  CREATE_PAGE: 'note.create_page',
  QUERY_PAGES: 'note.query_pages',
  GET_DETAIL_PAGE: 'note.get_detail_page',
  UPDATE_PAGE: 'note.update_page',
  DELETE_PAGE: 'note.delete_page',
  DUPLICATE_PAGE: 'note.duplicate_page',
  GET_TRASHED_PAGES: 'note.get_trashed_pages',
  RESTORE_PAGE: 'note.restore_page',

  // blocks
  CREATE_BLOCK: 'note.create_block',
  UPDATE_BLOCK: 'note.update_block',
  GET_BLOCKS_BY_PAGE_ID: 'note.get_blocks_by_page_id',
  GET_BLOCK_BY_ID: 'note.get_block_by_id',
  DELETE_BLOCK: 'note.delete_block',

  // permissions
  TOGGLE_USER_PERMISSION_BY_PAGE: 'note.toggle_user_permission_by_page',
  GET_USER_PERMISSION_BY_PAGE: 'note.get_user_permission_by_page',
  GET_PERMISSIONS_BY_PAGE: 'note.get_permissions_by_page',

  // database - properties
  CREATE_PROPERTY: 'note.create_property',
  UPDATE_PROPERTY: 'note.update_property',
  DELETE_PROPERTY: 'note.delete_property',
  GET_PROPERTIES_BY_PAGE: 'note.get_properties_by_page',

  // database - views
  CREATE_VIEW: 'note.create_view',
  UPDATE_VIEW: 'note.update_view',
  DELETE_VIEW: 'note.delete_view',
  GET_VIEWS_BY_PAGE: 'note.get_views_by_page',

  // database - property values
  SET_PROPERTY_VALUE: 'note.set_property_value',
  GET_PROPERTY_VALUES_FOR_ROWS: 'note.get_property_values_for_rows',
};
