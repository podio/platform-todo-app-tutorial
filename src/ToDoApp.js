var ToDoApp = window.ToDoApp = (function() {

  // Private members
    
  var _templates = {

    body:
      '<h1>Podio Platform To-do</h1>\
      <div id="left-col">\
        <div id="lists"></div>\
        <input id="create-list-name-input" placeholder="Create list" />\
      </div>\
      <div id="right-col">\
        <div id="tasks"></div>\
        <div>\
          <input type="text" id="create-task-name-input" placeholder="Create task">\
        </div>\
      </div>',
    list: '<a href="<%= href %>"><%= name %></a> <span class="remove">X</span>',
    task: '<label><input type="checkbox" <%= checked %> /> <%= name %></label> <span class="remove">X</span>'
  };
  
  function _bindPressEnter(callback) {
    return (function(evt) {
      if (evt.which === 13) {
        callback(evt);
      };
    });
  };

  var _bindButtons = function() {

    // Bind input for creating new lists
    this.containerElement.find('#create-list-name-input')
    .on('keyup', _bindPressEnter(function(evt) {

      this.createList({ title: $('#create-list-name-input').val() })
      .then(this.loadLists.bind(this))
      .then(this.drawLists.bind(this))
      .catch(console.error.bind(console));

      $('#create-list-name-input').val('');

    }.bind(this)));
    
    // Bind input for creating new tasks
    this.containerElement.find('#create-task-name-input')
    .on('keyup', _bindPressEnter(function(evt) {

      this.createTask({ title: $('#create-task-name-input').val() })
      .then(this.loadLists.bind(this))
      .then(this.loadTasks.bind(this))
      .then(this.drawTasks.bind(this))
      .catch(console.error.bind(console));
      
      $('#create-task-name-input').val('');

    }.bind(this)));
  };

  var _getCurrentList = function() {
    return window.location.hash.substring(1);
  };

  // Constructor

  function ToDoApp(config) {

    this.containerElement = $(config.container);
    this.containerElement.html(_templates.body).show();

    this.listsTemplateId = config.listsTemplateId;
    this.tasksTemplateId = config.tasksTemplateId;

    this.podio = config.podio;

    this.lists = [];
    this.tasks = [];

    _bindButtons.call(this);

    window.onhashchange = function() {

      this.drawLists()
      .then(this.drawTasks.bind(this, _getCurrentList()))
      .catch(console.error.bind(console));
    }.bind(this);

  };

  // Public members

  ToDoApp.prototype.setUpWorkspace = function() {

    var self = this;

    // Retrieve a list of existing organizations in this project
    return self.podio.request('get', '/org/').then(function(organizations) {

      // If the project contains any organizations,
      // we simply use the first one we find
      if (organizations.length > 0) {
        return Promise.resolve(organizations[0]);
      } 
      
      // Otherwise, we create a new organization that we can use
      return self.podio.request('post', '/org/', { name: 'todo-app-organization' });

    })
    .then(function(organization) {

      var org_id = organization.org_id;
      
      // When we have the organization we do the same thing for spaces.
      // First, get a list of the spaces that exist in this organization.
      return self.podio.request('get', '/space/org/' + org_id + '').then(function(spaces) {

        // If we have existing spaces, we pick the second space in the array,
        // since the first space is the automatically generated 'Employee Network' space
        if(spaces.length > 1) {
          return Promise.resolve(spaces[1]);
        }

        // Otherwise, we create a new space that we can use
        var spaceData = {
          name: 'todo-app-space',
          org_id: org_id,
        };

        return self.podio.request('post', '/space/', spaceData);
      })
      .then(function(space) {
        // Now that we have the space, we can store the space_id for later use
        self.spaceId = space.space_id;
        return Promise.resolve();
      });
    });
  };

  ToDoApp.prototype.loadLists = function() {
    
    var self = this;

    return new Promise(function(resolve, reject) {
      self.podio.request('post', 'item/app/' + self.listsTemplateId + '/filter/?space_id=' + self.spaceId)
      .then(function(response) {
        self.lists = response.items;
        return resolve();
      })
      .catch(reject);
    });
  };

  ToDoApp.prototype.loadTasks = function() {

    var self = this;

    return new Promise(function(resolve, reject) {
      self.podio.request('post','item/app/' + self.tasksTemplateId + '/filter/?space_id=' + self.spaceId)
      .then(function(response) {
        self.tasks = response.items;
        resolve();
      })
      .catch(reject);
    });
  };

  ToDoApp.prototype.setTaskStatus = function(taskId, evt) {

    var checkbox = evt.currentTarget;
    var task = _.find(this.tasks, { item_id: taskId });
    
    // Get a reference to the task status field,
    // so we can extract the correct sub_id for the field configuration values
    var taskStatusField = _.find(task.fields, { external_id: 'status' });
    
    // Convert the checkbox value into a string
    // that fits with our category field values
    var state = ['Pending', 'Done'][Number(checkbox.checked)];

    // Retrieve sub_id for the relavant state to use for the new status
    var newStatus = _.find(taskStatusField.config.settings.options, { text: state }).id;
    
    var taskData = {
      fields: {
        'status': [ newStatus ] // Notice the array. It is because category fields can have multiple values if configured for it
      }
    };

    // Save the task item
    return podio.request('put', 'item/' + taskId, taskData);
  };

  ToDoApp.prototype.drawTasks = function() {

    var self = this;
    var taskTemplate = _.template(_templates.task);
    var tasksElement = $('#tasks');
    
    // Clear all existing HTML in the task section
    tasksElement.empty();

    // If no current list is selected, we stop execution and display nothing
    if (_.isEmpty(_getCurrentList())) {
      return Promise.resolve();
    }

    // Get a reference to the selected list, by looking it up by its item_id
    var listItems = _.find(this.lists, { item_id: Number(_getCurrentList())});

    // Get a reference to the tasks of this list
    var listTasksReferences = _.find(listItems.fields, { external_id: 'tasks' });

    if (_.isEmpty(listTasksReferences)) {
      tasksElement.html('<p>(No tasks)</p>');
    } else {

      // If the list has task, iterate through them
      var tasks = listTasksReferences.values.forEach(function(taskReference) {

        var task = _.find(self.tasks, { item_id: taskReference.value.item_id });

        // Only proceed if the task exists in the app's internal reference
        if(_.isUndefined(task)) return;

        // Extract the various fields required for rendering
        var status = _.find(task.fields, { external_id: 'status' });
        var title = _.find(task.fields, { external_id: 'title' });
        var checked = status.values[0].value.text === 'Done';

        // Create a DOM node for the task and apply needed classes and content
        var taskElement = $('<div></div>');
        taskElement.addClass('task');
        taskElement.toggleClass('checked', checked);

        taskElement.html(taskTemplate({
          checked: checked ? 'checked' : '',
          name: title.values[0].value,
          class: status.values[0].value.text.toLowerCase()
        }));

        // Add click handler to the task so it can be checked/unchecked
        taskElement.find('input[type=checkbox]')
        .on('change', function(evt) {

          this.setTaskStatus(task.item_id, evt)
          .then(this.loadTasks.bind(this))
          .then(this.drawTasks.bind(this))
          .catch(console.error.bind(console));
        }.bind(self));

        // Add a click handler to the task's remove-button so the task can be deleted
        taskElement.find('.remove').on('click', function(taskId, evt) {

          this.deleteTask(taskId)
          .then(this.loadLists.bind(this))
          .then(this.loadTasks.bind(this))
          .then(this.drawTasks.bind(this))
          .catch(console.error.bind(console));
        }.bind(self, taskReference.value.item_id));

        // Add the task element to the task section DOM node of the page
        tasksElement.append(taskElement);
      });
    }
    return Promise.resolve();
  };

  ToDoApp.prototype.drawLists = function() {

    var self = this;
    var listTemplate = _.template(_templates.list);

    return Promise.resolve().then(function() {

      // Get a reference to the lists section of the left column
      // since list items should be rendered in this
      var listsElement = self.containerElement.find("#lists");

      // Clear existing HTML
      listsElement.empty();

      self.lists.forEach(function(listItem) {

        // Get a reference to the list item's title field
        var titleField = _.find(listItem.fields, { external_id: 'title' });
        
        // Iterate through each list that have valid field data values
        if(listItem.fields.length && titleField.values.length) {

          // Retrieve title and item_id
          var itemName = titleField.values[0].value;
          var itemId = listItem.item_id;

          // Create a DOM element for this list, using the list template
          // and append it to the left column list container element
          var itemElement = $('<div></div>').html(listTemplate({
            href: '#' + itemId,
            name: itemName
          }))
          .addClass('list')
          .toggleClass('active', itemId == _getCurrentList())
          .appendTo(listsElement);
          
          // Add a click handler to the remove button of the list,
          // so that the list can also be removed
          itemElement.find('.remove').on('click', function(listId) {

            this.deleteList(listId)
            .then(this.loadLists.bind(this))
            .then(this.drawLists.bind(this))
            .catch(console.error.bind(console));
          }.bind(self, itemId));
        }
      });
    });
  };

  ToDoApp.prototype.deleteTask = function(taskId) {
    return podio.request('del', 'item/' + taskId);
  };

  ToDoApp.prototype.deleteList = function(listId) {

    var list = _.find(this.lists, { item_id: listId });
    return podio.request('del', 'item/' + listId);

    // (If bulk deletion was supported)
    // var listTasksReferences = _.find(list.fields, { external_id: 'tasks' });
    // var taskItemIds = _.pluck(listTasksReferences.values, 'value.item_id');

    // return new Promise(function(resolve, reject) {
      // podio.request('post', 'item/app/' + this.listsTemplateId + '/delete', { item_ids: taskItemIds })
      // .then(function() {
      //   return podio.request('del', 'item/app/' + listId);
      // })
      // podio.request('del', 'item/' + listId)
      // .then(resolve)
      // .catch(reject);
    // }.bind(this));
  }

  ToDoApp.prototype.createList = function(listData) {

    var data = {
      fields: {
        'title': listData.title
      },
      space_id: this.spaceId
    };
    return podio.request('post', 'item/app/' + this.listsTemplateId, data);
  };

  ToDoApp.prototype.createTask = function(taskData) {

    var self = this;

    // Prepare the data to be submitted for the new task
    var data = {
      fields: {
        'title': taskData.title,
        'status': [ 2 ]
      },
      space_id: this.spaceId
    };

    return new Promise(function(resolve, reject) {

      // Create the task on the backend
      podio.request('post', 'item/app/' + self.tasksTemplateId, data)
      .then(function(newlyCreatedTask) {

        // Get a reference to the current list and its list of tasks,
        // as we want to push the newlyCreatedTask to this list.
        var currentList = _.find(self.lists, { item_id: Number(_getCurrentList()) });
        var currentListTaskData = _.find(currentList.fields, { external_id: 'tasks' });
        var newTaskData = [];

        // Map over existing tasks to extract their item_id,
        // as this is the format that the backend expects
        if (currentListTaskData) {
          newTaskData = currentListTaskData.values.map(function(fieldValue) {
            return { value: fieldValue.value.item_id };
          });
        }

        // Add our new task
        newTaskData.push({ value: newlyCreatedTask.item_id });

        var listData = {
          fields: {
            tasks: newTaskData
          }
        };
        
        // Finally, update the list with the newly created task
        return podio.request('put', 'item/' + _getCurrentList(), listData);
      })
      .then(resolve)
      .catch(reject);
    });
  };

  return ToDoApp;
})();