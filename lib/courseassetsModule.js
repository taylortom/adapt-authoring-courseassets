const AbstractApiModule = require('adapt-authoring-api');
const path = require('path');
/**
* Module which handles courseassets
* preserves legacy courseassets routes
* Uses events to automatically insert, update and delete courseassets
* @extends {AbstractApiModule}
*/
class CourseAssetsModule extends AbstractApiModule {
  /** @override */
  async setValues() {
    /** @ignore */ this.root = 'courseassets';
    /** @ignore */ this.routes = [];
    /** @ignore */ this.schemaName = 'courseasset';
    /** @ignore */ this.collectionName = 'courseassets';
  }
  /**
  * Initialise the module
  * @return {Promise}
  */
  async init() {
    await super.init();

    const [assets, content, jsonschema] = await this.app.waitForModule('assets', 'content', 'jsonschema');
    this.assets = assets;
    this.content = content;
    this.jsonschema = jsonschema;
    
    this.app.onReady().then(async () => {
      const actions = ['insert','update','replace','delete'];
      actions.forEach(action => this.content.on(action, (...args) => this.handleContentEvent(action, ...args)));
    });
    this.setReady();
  }
  /**
  * Search data object for asset types and retrieve records from the DB
  * @param {Object} data
  */
   async extractAssets(data) {
    if (typeof data !== 'object' || !data.hasOwnProperty('_type')) return;
    // internal function to be called recursively
    const _extractAssetsRecursive = (schema, data, assets = new Set()) => {
      Object.entries(schema).forEach(([key,val]) => {
        if(val.properties) {
          _extractAssetsRecursive(val.properties, data[key], assets);
        } else if(val?.items?.properties && data[key]) {
          data[key].forEach(d => _extractAssetsRecursive(val.items.properties, d, assets));
        } else if(val?._backboneForms?.type === "Asset") {
          assets.add(data[key].toString());
        }
      });
      return assets;
    };
    const { properties } = await this.jsonschema.getSchema(await this.content.getContentSchemaName(data));
    const _ids = Array.from(_extractAssetsRecursive(properties, data));
    return Promise.all(_ids.map(async _id => (await this.assets.find({ _id }))[0]));
  }
  /**
   * Handler for content event
   * @param {String} action The action performed
   * @param {object} arg1 First argument passed by the event
   * @param {object} arg2 Second argument passed by the event
   */
  async handleContentEvent(action, arg1, arg2) {
    if(action === 'update' || action === 'replace') {
      return Promise.all([ // in the case of an update, we delete and replace
        this.handleContentEvent('delete', arg1), 
        this.handleContentEvent('insert', arg2)
      ]);
    }
    if (action === 'delete' && arg1._type === 'course') {
      return await super.delete({ _courseId: arg1._courseId });
    }
    const assets = await this.extractAssets(arg1);
    if (!assets.length) {
      return;
    }
    await Promise.allSettled(assets.map(async a => {
      try {
        await this[action]({ 
          _courseId: arg1._courseId.toString(), 
          _contentId: arg1._id.toString(),
          _assetId: a._id.toString()
        });
      } catch(e) {
        if(action !== 'delete') this.log('error', `Failed to ${action} courseasset document, ${e}`);
      }
    }));
  }
}

module.exports = CourseAssetsModule;