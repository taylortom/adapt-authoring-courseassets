import AbstractApiModule from 'adapt-authoring-api';
/**
* Module which handles courseassets automatically using on content events
* @extends {AbstractApiModule}
*/
export default class CourseAssetsModule extends AbstractApiModule {
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
    /**
     * Cached module instance for easy access
     * @type {AssetsModule}
     */
    this.assets = assets;
    /**
     * Cached module instance for easy access
     * @type {ContentModule}
     */
    this.content = content;
    /**
     * Cached module instance for easy access
     * @type {JsonSchemaModule}
     */
    this.jsonschema = jsonschema;
    
    this.app.onReady().then(async () => {
      ['insert','update','replace','delete'].forEach(action => { // note we just log any errors
        this.content.on(action, (...args) => this.handleContentEvent(action, ...args).catch(e => this.log('error', e)));
      });
    });
    this.setReady();
  }
  /**
   * Utility function to access the deleteMany function of the MongoDB Node.js driver
   * @param {Object} query
   * @return {Promise}
   */
  async deleteMany(query) {
    const mongodb = await this.app.waitForModule('mongodb');
    return mongodb.getCollection(this.collectionName).deleteMany(query);
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
        if(data[key] === undefined) {
          return;
        }
        if(val.properties) {
          _extractAssetsRecursive(val.properties, data[key], assets);
        } else if(val?.items?.properties) {
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
    const ids = Array.from(_extractAssetsRecursive(schema.properties, data));
    return Promise.all(ids.map(async _id => (await this.assets.find({ _id }))[0] || _id));
  }
  /**
   * Handler for content event
   * @param {String} action The action performed
   * @param {object} arg1 First argument passed by the event
   * @param {object} arg2 Second argument passed by the event
   */
  async handleContentEvent(action, arg1, arg2) {
    const _contentId = arg1._id;
    const _courseId = arg1._courseId;

    if(action === 'delete' && arg1._type === 'course') {
      return await this.deleteMany({ _courseId });
    }
    const isModify = action === 'update' || action === 'replace';
    const assets = await this.extractAssets(isModify ? arg2 : arg1);

    if(isModify) { // remove all old records first
      try { 
        await this.deleteMany({ _courseId, _contentId }); 
      } catch(e) {}
    }
    if(!assets.length) {
      return;
    }
    // console.log(assets);
    await Promise.allSettled(assets.map(async a => {
      try {
        if(!a._id) {
          throw new Error(`no asset found with _id ${a}`);
        }
        await this.insert({ 
          _courseId: _courseId.toString(), 
          _contentId: _contentId.toString(), 
          _assetId: a._id.toString() 
        });
      } catch(e) {
        this.log('error', `Failed to insert courseasset document, ${e}`);
      }
    }));
  }
}