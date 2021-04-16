const AbstractApiModule = require('adapt-authoring-api');
/**
* Module which handles courseassets automatically using on content events
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
      ['insert','update','replace','delete'].forEach(action => { // note we just log any errors
        this.content.on(action, (...args) => this.handleContentEvent(action, ...args).catch(e => this.log('error', e)));
      });
    });
    this.setReady();
  }
  /**
  * Search data object for asset types and retrieve records from the DB
  * @param {Object} data
  */
   async extractAssets(data) {
    if (typeof data !== 'object' || !data.hasOwnProperty('_type')) return [];
    // internal function to be called recursively
    const _extractAssetsRecursive = (schema, data, assets = new Set()) => {
      Object.entries(schema).forEach(([key,val]) => {
        if(val.properties) {
          _extractAssetsRecursive(val.properties, data[key], assets);
        } else if(val?.items?.properties && data[key]) {
          data[key].forEach(d => _extractAssetsRecursive(val.items.properties, d, assets));
        } else if(val?._backboneForms?.type === "Asset" || val?._backboneForms === "Asset") {
          assets.add(data[key].toString());
        }
      });
      return assets;
    };
    let schema;
    try {
      schema = await this.jsonschema.getSchema(await this.content.getContentSchemaName(data));
    } catch(e) { // don't need to do anything, just ignore
      return [];
    } 
    const _ids = Array.from(_extractAssetsRecursive(schema.properties, data));
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