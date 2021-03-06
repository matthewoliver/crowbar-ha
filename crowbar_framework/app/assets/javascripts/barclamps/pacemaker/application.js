/**
 * Copyright 2011-2013, Dell
 * Copyright 2013-2014, SUSE LINUX Products GmbH
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

;(function($, doc, win) {
  'use strict';

  function StonithNodeAgents(el, options) {
    this.root = $(el);
    this.html = {
      table_row: '<tr data-id="{0}" data-alias="{1}"><td>{1}</td><td><input type="text" class="form-control" value="{2}"/></td></tr>'
    };

    this.options = $.extend(
      {
        attr_type: 'string',
        attr_name: 'params',
        attr_writer: function(val) { return val; },
        attr_reader: function(val) { return val; },
        storage: '#proposal_attributes',
        deployment_storage: '#proposal_deployment',
        path: 'stonith/per_node/nodes',
        watchedRoles: ['pacemaker-cluster-member', 'pacemaker-remote']
      },
      options
    );

    this.initialize();
  }

  StonithNodeAgents.prototype._ignore_event = function(evt, data) {
    var self = this;

    var row_id = 'tr[data-id="{0}"]'.format(data.id);
    var row    = this.root.find(row_id)

    if (self.options.watchedRoles.indexOf(data.role) == -1) { return true; }
    if (evt.type == 'nodeListNodeAllocated' && row.length > 0) { return true; }
    if (evt.type == 'nodeListNodeUnallocated' && row.length == 0) { return true; }

    return false;
  };

  StonithNodeAgents.prototype.initialize = function() {
    var self = this;

    // Update nodes that have been moved around in deployment
    self.updateNodesFromDeployment();
    // Render what we already have
    self.renderAgentParams();
    // And start listening on changes
    self.registerEvents();
  };

  StonithNodeAgents.prototype.registerEvents = function() {
    var self = this;

    // Update JSON on input changes
    this.root.find('tbody tr').live('change', function(evt) {
      var elm = $(this);
      var id  = elm.data('id');
      var key = '{0}/{1}'.format(id, self.options.attr_name);
      var val = self.options.attr_writer(elm.find('input').val());

      self.writeJson(key, val, self.options.attr_type);
    });

    // Append new table row and update JSON on node alloc
    $(document).on('nodeListNodeAllocated', this.root, function(evt, data) {
      if (self._ignore_event(evt, data)) { return; }

      $(this).find('tbody').append(self.html.table_row.format(data.id, self._node_name_to_alias(data.id), ''));

      var key = '{0}/{1}'.format(data.id, self.options.attr_name);
      var val = self.options.attr_writer("");

      self.writeJson(key, val, self.options.attr_type);
      self.sortAgentParams();
    });

    // Remove the table row and update JSON on node dealloc
    $(document).on('nodeListNodeUnallocated', this.root, function(evt, data) {
      if (self._ignore_event(evt, data)) { return; }

      self.root.find('[data-id="{0}"]'.format(data.id)).remove();
      self.removeJson(data.id, null, "map");
    });
  };

  StonithNodeAgents.prototype.updateNodesFromDeployment = function() {
    var self = this;

    var agent_params = self.retrieveAgentParams();

    // Get a membership hash on both sides
    var existing_nodes = {};
    var deployed_nodes = {};

    $.each(agent_params, function(node, value) { existing_nodes[node] = true; });

    $.each(self.options.watchedRoles, function(index, role) {
      var role_path  = 'elements/{0}'.format(role);
      var role_nodes = $(self.options.deployment_storage).readJsonAttribute(role_path, {});
      $.each(role_nodes, function(index, node) { deployed_nodes[node] = true; });
    });

    // Then update all those nodes which have been removed from deployment
    for (var existing_node in existing_nodes) {
       if (!deployed_nodes[existing_node]) { self.removeJson(existing_node, null, "map"); }
    }
    // and those which have been added
    for (var deployed_node in deployed_nodes) {
       if (!existing_nodes[deployed_node]) {
         var key = '{0}/{1}'.format(deployed_node, self.options.attr_name);
         var val = self.options.attr_writer("");
         self.writeJson(key, val, self.options.attr_type);
       }
    }
  };

  StonithNodeAgents.prototype._node_name_to_alias = function(name) {
    var node_info = this.root.data('nodes')[name];
    return !!node_info ? node_info.alias : name.split('.')[0]
  };

  StonithNodeAgents.prototype.sortAgentParams = function() {
    var self = this;

    var rows = [];
    $.each(this.root.find('tbody tr'), function(index, tr) {
      rows.push([$(tr).data('id'), $(tr).data('alias'), $(tr).find('input').val()]);
    });

    // Sort by node alias
    rows.sort(function(a, b) {
      if (a[1] > b[1]) { return 1;  }
      if (a[1] < b[1]) { return -1; }
      return 0;
    });

    var params = $.map(rows, function(row) {
      var encoded_input = Handlebars.Utils.escapeExpression(row[2]);
      return self.html.table_row.format(row[0], row[1], encoded_input);
    });
    this.root.find('tbody').html(params.join(''));
  };

  // Initial render
  StonithNodeAgents.prototype.renderAgentParams = function() {
    var self = this;

    var params = $.map(self.retrieveAgentParams(), function(value, node_id) {
      var encoded_value = Handlebars.Utils.escapeExpression(self.options.attr_reader(value[self.options.attr_name]));
      return self.html.table_row.format(node_id, self._node_name_to_alias(node_id), encoded_value);
    });

    this.root.find('tbody').html(params.join(''));
    self.sortAgentParams();
  };

  // FIXME: these could be refactored into a common agent
  StonithNodeAgents.prototype.retrieveAgentParams = function() {
    return $(this.options.storage).readJsonAttribute(
      this.options.path,
      {}
    );
  };

  StonithNodeAgents.prototype.writeJson = function(key, value, type) {
    return $(this.options.storage).writeJsonAttribute(
      '{0}/{1}'.format(
        this.options.path,
        key
      ),
      value,
      type
    );
  };

  StonithNodeAgents.prototype.removeJson = function(key, value, type) {
    return $(this.options.storage).removeJsonAttribute(
      '{0}/{1}'.format(
        this.options.path,
        key
      ),
      value,
      type
    );
  };

  $.fn.stonithNodeAgents = function(options) {
    return this.each(function() {
      new StonithNodeAgents(this, options);
    });
  };
}(jQuery, document, window));

function update_no_quorum_policy(evt, init) {
  var no_quorum_policy_el = $('#crm_no_quorum_policy');
  var non_forced_policy = no_quorum_policy_el.data('non-forced');
  var was_forced_policy = no_quorum_policy_el.data('is-forced');
  var members = $('#pacemaker-cluster-member').children().length;

  if (non_forced_policy == undefined) {
    non_forced_policy = "stop";
  }

  if (evt != undefined) {
    // 'nodeListNodeAllocated' is fired after the element has been added, so
    // nothing to do. However, 'nodeListNodeUnallocated' is fired before the
    // element is removed, so we need to fix the count.
    if (evt.type == 'nodeListNodeUnallocated') { members -= 1; }
  }

  if (members > 1) {
    if (was_forced_policy) {
      no_quorum_policy_el.val(non_forced_policy);
      no_quorum_policy_el.removeData('non-forced');
    }
    no_quorum_policy_el.data('is-forced', false)
    no_quorum_policy_el.removeAttr('disabled');
  } else {
    if (!init && !was_forced_policy) {
      no_quorum_policy_el.data('non-forced', no_quorum_policy_el.val());
    }
    no_quorum_policy_el.data('is-forced', true)
    no_quorum_policy_el.val("ignore");
    no_quorum_policy_el.attr('disabled', 'disabled');
  }
}

function cb_corosync_ring_delete()
{
  ring_index = $(this).data("ringid");

  // delete the ring entry from the attributes JSON
  rings = $('#proposal_attributes').readJsonAttribute('corosync/rings', {});
  rings.splice(ring_index, 1);
  $('#proposal_attributes').writeJsonAttribute('corosync/rings', rings);

  $('#ring-index-' + ring_index).hide('slow', function() {
    redisplay_rings();
  });

  return false;
}

function attach_events()
{
  $('#corosync-rings [data-change]').updateAttribute();

  $('.corosync-ring-delete').on('click', cb_corosync_ring_delete);
  $('#corosync-rings [data-hideit]').trigger('change');
  $('#corosync-rings [data-showit]').trigger('change');
}

function detach_events()
{
  $('#corosync-rings [data-change]').off('change keyup');
  $('.corosync-ring-delete').off('click');
}

var corosync_ring_template;
var max_corosync_rings = 2;
function redisplay_rings()
{
  if (!corosync_ring_template) {
    corosync_ring_template = Handlebars.compile(
      $('#ring-entries').html()
    );

    Handlebars.registerHelper("inc", function(value) {
      return parseInt(value) + 1;
    });
  }

  rings = $('#proposal_attributes').readJsonAttribute('corosync/rings', {});

  // Render forms for ring list
  $('#corosync-rings').replaceWith(
    corosync_ring_template({
      "entries": rings,
      "at_min_entries": rings.length == 1
    })
  );

  $.map($('#corosync_transport option'), function(option) {
    if (!option.selected) {
      $('.ring_{0}_container'.format(option.value)).hide();
    }
  });

  if (rings.length >= max_corosync_rings) {
    $('#ring-add').hide('slow');
  } else {
    $('#ring-add').show('slow');
  }

  // refresh data-change handlers
  detach_events();
  attach_events();
}

$(document).ready(function($) {
  $('#stonith_per_node_container').stonithNodeAgents();
  $('#stonith_sbd_container').stonithNodeAgents({
    path:'stonith/sbd/nodes',
    attr_name:'devices',
    attr_type:'seq',
    attr_reader:function(val) { return val.join(', '); },
    attr_writer:function(val) { return val.replace(/ /g, ',').replace(/,+/g, ',').replace(/,$/, '').split(','); }
  });

  // FIXME: apparently using something else than
  // $('#stonith_per_node_container') breaks the per-node table :/
  $(document).on('nodeListNodeAllocated', function(evt, data) {
    update_no_quorum_policy(evt, false)
  });
  $(document).on('nodeListNodeUnallocated', function(evt, data) {
    update_no_quorum_policy(evt, false)
  });

  update_no_quorum_policy(undefined, true)

  if ($.queryString.attr_raw != "true") {
    redisplay_rings();
  }

  $('#add-ring-button').click(function() {
    var new_ring = {
      'network': $('#corosync_rings_index_network').val(),
      'mcast_addr': $('#corosync_rings_index_mcast_addr').val(),
      'mcast_port': 5405
    };

    rings = $('#proposal_attributes').readJsonAttribute('corosync/rings', {});
    rings.push(new_ring);
    $('#proposal_attributes').writeJsonAttribute('corosync/rings', rings);

    // Reset field entries
    $('#corosync_rings_index_network').val('');
    $('#corosync_rings_index_mcast_addr').val('');

    redisplay_rings();
  });
});
