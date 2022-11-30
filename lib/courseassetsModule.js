import AbstractApiModule from 'adapt-authoring-api';
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
      ['insert','update','delete'].forEach(action => { // note we just log any errors
        const hookName = `post${action[0].toUpperCase()}${action.slice(1)}Hook`;
        this.content[hookName].tap(async (...args) => {
          try {
            await this.handleContentEvent(action, ...args).catch(e => this.log('error', e));
          } catch(e) {
            this.log('error', 'COURSEASSETS_UPDATE', e);
          }
        });
      });
    });
    this.setReady();
  }
  /**
   * Search data object for asset types and retrieve _ids
   * @param {Object} data
   */
  extractAssetIds(schema, data, assets = []) {
    Object.entries(schema).forEach(([key, val]) => {
      if(!data.hasOwnProperty(key)) {
        return;
      }
      if(val.properties) {
        this.extractAssetIds(val.properties, data[key], assets);
      } else if(val?.items?.properties) {
        data[key].forEach(d => this.extractAssetIds(val.items.properties, d, assets));
      } else {
        if(val?._backboneForms?.type === "Asset" || val?._backboneForms === "Asset") assets.push(data[key].toString());
      }
    });
    return Array.from(new Set(assets));
  };
  /**
   * Handler for content event
   * @param {String} action The action performed
   * @param {object} arg1 First argument passed by the event
   * @param {object} arg2 Second argument passed by the event
   */
  async handleContentEvent(action, arg1, arg2) {
    const { _id: _contentId, _courseId, _type } = arg1;
    const isModify = action === 'update';

    if(action === 'delete' && _type === 'course') {
      return await this.deleteMany({ _courseId });
    }
    // delete any existing course assets for content
    await this.deleteMany({ _courseId, _contentId }); 

    const schema = await this.jsonschema.getSchema(await this.content.getContentSchemaName(data));
    const ids = this.extractAssetIds(schema.properties, isModify ? arg2 : arg1);
    if(!ids.length) {
      return;
    }
    return Promise.all(ids.map(async _id => {
      const [asset] = await this.assets.find({ _id });
      if(!asset) {
        throw this.app.errors.NOT_FOUND.setData({ type: 'asset' });
      }
      await this.insert({ 
        _courseId: _courseId.toString(), 
        _contentId: _contentId.toString(), 
        _assetId: asset._id.toString() 
      });
    }));
  }
}

export default CourseAssetsModule;