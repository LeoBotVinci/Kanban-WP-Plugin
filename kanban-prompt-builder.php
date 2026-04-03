<?php
/**
 * Plugin Name: Kanban Prompt Builder
 * Description: A visual prompt builder using a Kanban-style board. Use the [kanban_prompt_builder] shortcode on any page.
 * Version: 1.0.0
 * Author: Mike
 * License: GPL v2 or later
 * Text Domain: kanban-prompt-builder
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'KPB_VERSION', '1.0.0' );
define( 'KPB_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'KPB_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

/* ─────────────────────────────────────────────
   Activation — create tables & default board
   ───────────────────────────────────────────── */
register_activation_hook( __FILE__, 'kpb_activate' );

function kpb_activate() {
    global $wpdb;
    $charset = $wpdb->get_charset_collate();

    $boards_table = $wpdb->prefix . 'kpb_boards';
    $cards_table  = $wpdb->prefix . 'kpb_cards';

    $sql_boards = "CREATE TABLE {$boards_table} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        columns_json LONGTEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
    ) {$charset};";

    $sql_cards = "CREATE TABLE {$cards_table} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        board_id BIGINT UNSIGNED NOT NULL,
        column_id VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL DEFAULT '',
        prompt_text TEXT NOT NULL DEFAULT '',
        image_url TEXT NOT NULL DEFAULT '',
        sort_order INT NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY board_id (board_id),
        KEY column_id (column_id)
    ) {$charset};";

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta( $sql_boards );
    dbDelta( $sql_cards );

    // Create default board if none exists.
    $existing = $wpdb->get_var( "SELECT COUNT(*) FROM {$boards_table}" );
    if ( ! $existing ) {
        $default_columns = array(
            array( 'id' => 'col-style',   'name' => 'Style' ),
            array( 'id' => 'col-subject', 'name' => 'Subject' ),
            array( 'id' => 'col-setting', 'name' => 'Setting' ),
            array( 'id' => 'col-details', 'name' => 'Details' ),
        );
        $wpdb->insert( $boards_table, array(
            'name'         => 'Default Board',
            'columns_json' => wp_json_encode( $default_columns ),
        ) );
    }
}

/* ─────────────────────────────────────────────
   Shortcode
   ───────────────────────────────────────────── */
add_shortcode( 'kanban_prompt_builder', 'kpb_render_shortcode' );

function kpb_render_shortcode( $atts ) {
    $atts = shortcode_atts( array( 'board' => '' ), $atts, 'kanban_prompt_builder' );

    // Resolve board ID.
    $board_id = absint( $atts['board'] );
    if ( ! $board_id ) {
        global $wpdb;
        $board_id = (int) $wpdb->get_var( "SELECT id FROM {$wpdb->prefix}kpb_boards ORDER BY id ASC LIMIT 1" );
    }

    if ( ! $board_id ) {
        return '<p>No Kanban board found. Please reactivate the plugin.</p>';
    }

    $can_edit = current_user_can( 'edit_posts' );

    // Enqueue assets.
    wp_enqueue_style( 'kpb-kanban', KPB_PLUGIN_URL . 'assets/css/kanban.css', array(), KPB_VERSION );
    wp_enqueue_script( 'kpb-kanban', KPB_PLUGIN_URL . 'assets/js/kanban.js', array(), KPB_VERSION, true );

    if ( $can_edit ) {
        wp_enqueue_media();
    }

    wp_localize_script( 'kpb-kanban', 'kpbData', array(
        'restUrl'  => esc_url_raw( rest_url( 'kpb/v1' ) ),
        'nonce'    => wp_create_nonce( 'wp_rest' ),
        'boardId'  => $board_id,
        'canEdit'  => $can_edit,
        'pluginUrl'=> KPB_PLUGIN_URL,
    ) );

    $edit_attr = $can_edit ? 'true' : 'false';
    return '<div id="kpb-app" data-board-id="' . esc_attr( $board_id ) . '" data-can-edit="' . $edit_attr . '"></div>';
}

/* ─────────────────────────────────────────────
   REST API
   ───────────────────────────────────────────── */
add_action( 'rest_api_init', 'kpb_register_routes' );

function kpb_register_routes() {
    $ns = 'kpb/v1';

    // ── Boards ──
    register_rest_route( $ns, '/boards', array(
        array( 'methods' => 'GET',  'callback' => 'kpb_get_boards',  'permission_callback' => '__return_true' ),
        array( 'methods' => 'POST', 'callback' => 'kpb_create_board','permission_callback' => 'kpb_can_edit' ),
    ) );

    register_rest_route( $ns, '/boards/(?P<id>\d+)', array(
        array( 'methods' => 'GET',    'callback' => 'kpb_get_board',    'permission_callback' => '__return_true' ),
        array( 'methods' => 'PUT',    'callback' => 'kpb_update_board', 'permission_callback' => 'kpb_can_edit' ),
        array( 'methods' => 'DELETE', 'callback' => 'kpb_delete_board', 'permission_callback' => 'kpb_can_edit' ),
    ) );

    register_rest_route( $ns, '/boards/(?P<id>\d+)/columns', array(
        array( 'methods' => 'PUT', 'callback' => 'kpb_update_columns', 'permission_callback' => 'kpb_can_edit' ),
    ) );

    // ── Cards ──
    register_rest_route( $ns, '/cards', array(
        array( 'methods' => 'GET',  'callback' => 'kpb_get_cards',  'permission_callback' => '__return_true' ),
        array( 'methods' => 'POST', 'callback' => 'kpb_create_card','permission_callback' => 'kpb_can_edit' ),
    ) );

    register_rest_route( $ns, '/cards/(?P<id>\d+)', array(
        array( 'methods' => 'GET',    'callback' => 'kpb_get_card',    'permission_callback' => '__return_true' ),
        array( 'methods' => 'PUT',    'callback' => 'kpb_update_card', 'permission_callback' => 'kpb_can_edit' ),
        array( 'methods' => 'DELETE', 'callback' => 'kpb_delete_card', 'permission_callback' => 'kpb_can_edit' ),
    ) );

    register_rest_route( $ns, '/cards/(?P<id>\d+)/move', array(
        array( 'methods' => 'PUT', 'callback' => 'kpb_move_card', 'permission_callback' => 'kpb_can_edit' ),
    ) );
}

function kpb_can_edit() {
    return current_user_can( 'edit_posts' );
}

/* ── Board handlers ── */

function kpb_get_boards( $request ) {
    global $wpdb;
    $rows = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}kpb_boards ORDER BY id ASC" );
    foreach ( $rows as &$r ) {
        $r->columns_json = json_decode( $r->columns_json, true );
    }
    return rest_ensure_response( $rows );
}

function kpb_get_board( $request ) {
    global $wpdb;
    $id  = absint( $request['id'] );
    $row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}kpb_boards WHERE id = %d", $id ) );
    if ( ! $row ) {
        return new WP_Error( 'not_found', 'Board not found', array( 'status' => 404 ) );
    }
    $row->columns_json = json_decode( $row->columns_json, true );
    return rest_ensure_response( $row );
}

function kpb_create_board( $request ) {
    global $wpdb;
    $name    = sanitize_text_field( $request->get_param( 'name' ) );
    $columns = $request->get_param( 'columns' );
    if ( ! $name ) {
        $name = 'New Board';
    }
    if ( ! is_array( $columns ) ) {
        $columns = array();
    }
    $wpdb->insert( $wpdb->prefix . 'kpb_boards', array(
        'name'         => $name,
        'columns_json' => wp_json_encode( $columns ),
    ) );
    return rest_ensure_response( array( 'id' => $wpdb->insert_id, 'name' => $name, 'columns_json' => $columns ) );
}

function kpb_update_board( $request ) {
    global $wpdb;
    $id   = absint( $request['id'] );
    $data = array();
    if ( $request->get_param( 'name' ) !== null ) {
        $data['name'] = sanitize_text_field( $request->get_param( 'name' ) );
    }
    if ( $request->get_param( 'columns' ) !== null ) {
        $data['columns_json'] = wp_json_encode( $request->get_param( 'columns' ) );
    }
    if ( empty( $data ) ) {
        return new WP_Error( 'no_data', 'Nothing to update', array( 'status' => 400 ) );
    }
    $wpdb->update( $wpdb->prefix . 'kpb_boards', $data, array( 'id' => $id ) );
    return kpb_get_board( $request );
}

function kpb_delete_board( $request ) {
    global $wpdb;
    $id = absint( $request['id'] );
    $wpdb->delete( $wpdb->prefix . 'kpb_boards', array( 'id' => $id ) );
    $wpdb->delete( $wpdb->prefix . 'kpb_cards', array( 'board_id' => $id ) );
    return rest_ensure_response( array( 'deleted' => true ) );
}

function kpb_update_columns( $request ) {
    global $wpdb;
    $id      = absint( $request['id'] );
    $columns = $request->get_param( 'columns' );
    if ( ! is_array( $columns ) ) {
        return new WP_Error( 'invalid', 'columns must be an array', array( 'status' => 400 ) );
    }
    $wpdb->update( $wpdb->prefix . 'kpb_boards', array(
        'columns_json' => wp_json_encode( $columns ),
    ), array( 'id' => $id ) );

    $row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}kpb_boards WHERE id = %d", $id ) );
    $row->columns_json = json_decode( $row->columns_json, true );
    return rest_ensure_response( $row );
}

/* ── Card handlers ── */

function kpb_get_cards( $request ) {
    global $wpdb;
    $board_id = absint( $request->get_param( 'board_id' ) );
    $where    = $board_id ? $wpdb->prepare( " WHERE board_id = %d", $board_id ) : '';
    $rows     = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}kpb_cards{$where} ORDER BY sort_order ASC, id ASC" );
    return rest_ensure_response( $rows );
}

function kpb_get_card( $request ) {
    global $wpdb;
    $id  = absint( $request['id'] );
    $row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}kpb_cards WHERE id = %d", $id ) );
    if ( ! $row ) {
        return new WP_Error( 'not_found', 'Card not found', array( 'status' => 404 ) );
    }
    return rest_ensure_response( $row );
}

function kpb_create_card( $request ) {
    global $wpdb;
    $table = $wpdb->prefix . 'kpb_cards';

    $board_id    = absint( $request->get_param( 'board_id' ) );
    $column_id   = sanitize_text_field( $request->get_param( 'column_id' ) );
    $title       = sanitize_text_field( $request->get_param( 'title' ) );
    $prompt_text = sanitize_textarea_field( $request->get_param( 'prompt_text' ) );
    $image_url   = esc_url_raw( $request->get_param( 'image_url' ) );

    $max_sort = (int) $wpdb->get_var( $wpdb->prepare(
        "SELECT MAX(sort_order) FROM {$table} WHERE board_id = %d AND column_id = %s",
        $board_id, $column_id
    ) );

    $wpdb->insert( $table, array(
        'board_id'    => $board_id,
        'column_id'   => $column_id,
        'title'       => $title,
        'prompt_text' => $prompt_text,
        'image_url'   => $image_url,
        'sort_order'  => $max_sort + 1,
    ) );

    $new_id = $wpdb->insert_id;
    $row    = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $new_id ) );
    return rest_ensure_response( $row );
}

function kpb_update_card( $request ) {
    global $wpdb;
    $id    = absint( $request['id'] );
    $table = $wpdb->prefix . 'kpb_cards';
    $data  = array();

    $fields = array(
        'title'       => 'sanitize_text_field',
        'prompt_text' => 'sanitize_textarea_field',
        'image_url'   => 'esc_url_raw',
        'column_id'   => 'sanitize_text_field',
        'sort_order'  => 'absint',
    );

    foreach ( $fields as $field => $sanitizer ) {
        $val = $request->get_param( $field );
        if ( $val !== null ) {
            $data[ $field ] = call_user_func( $sanitizer, $val );
        }
    }

    if ( empty( $data ) ) {
        return new WP_Error( 'no_data', 'Nothing to update', array( 'status' => 400 ) );
    }

    $wpdb->update( $table, $data, array( 'id' => $id ) );

    $row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $id ) );
    return rest_ensure_response( $row );
}

function kpb_delete_card( $request ) {
    global $wpdb;
    $id = absint( $request['id'] );
    $wpdb->delete( $wpdb->prefix . 'kpb_cards', array( 'id' => $id ) );
    return rest_ensure_response( array( 'deleted' => true ) );
}

function kpb_move_card( $request ) {
    global $wpdb;
    $id         = absint( $request['id'] );
    $column_id  = sanitize_text_field( $request->get_param( 'column_id' ) );
    $sort_order = absint( $request->get_param( 'sort_order' ) );
    $table      = $wpdb->prefix . 'kpb_cards';

    $card = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $id ) );
    if ( ! $card ) {
        return new WP_Error( 'not_found', 'Card not found', array( 'status' => 404 ) );
    }

    // Shift existing cards in target column to make room.
    $wpdb->query( $wpdb->prepare(
        "UPDATE {$table} SET sort_order = sort_order + 1 WHERE board_id = %d AND column_id = %s AND sort_order >= %d AND id != %d",
        $card->board_id, $column_id, $sort_order, $id
    ) );

    $wpdb->update( $table, array(
        'column_id'  => $column_id,
        'sort_order' => $sort_order,
    ), array( 'id' => $id ) );

    $row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $id ) );
    return rest_ensure_response( $row );
}

/* ─────────────────────────────────────────────
   Admin menu — usage instructions
   ───────────────────────────────────────────── */
add_action( 'admin_menu', 'kpb_admin_menu' );

function kpb_admin_menu() {
    add_menu_page(
        'Kanban Prompt Builder',
        'Kanban Prompts',
        'edit_posts',
        'kanban-prompt-builder',
        'kpb_admin_page',
        'dashicons-layout',
        30
    );
}

function kpb_admin_page() {
    ?>
    <div class="wrap">
        <h1>Kanban Prompt Builder</h1>
        <div class="card" style="max-width:720px;">
            <h2>How to Use</h2>
            <ol>
                <li>Add the shortcode <code>[kanban_prompt_builder]</code> to any page or post.</li>
                <li>Visit that page while logged in to manage columns and cards.</li>
                <li>Upload images and add prompt text to each card.</li>
                <li>Visitors (or you) can click <strong>Add</strong> on cards to build a comma-separated prompt in the right panel.</li>
                <li>Click <strong>Copy</strong> to copy the prompt to the clipboard.</li>
            </ol>
            <h2>Shortcode Options</h2>
            <p><code>[kanban_prompt_builder board="2"]</code> — display a specific board by ID.</p>
            <h2>Tips</h2>
            <ul>
                <li>Drag and drop cards between columns to reorganise.</li>
                <li>Click the pencil icon on a column header to rename it.</li>
                <li>Non-logged-in visitors can use the prompt builder in read-only mode (no editing).</li>
            </ul>
        </div>
    </div>
    <?php
}
