import AbstractApiModule from 'adapt-authoring-api';
/**
 * Module which handles courseassets automatically using on content events
 * @memberof courseassets
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

    const [assets, content] = await this.app.waitForModule('assets', 'content');
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
    
    this.assets.preDeleteHook.tap(this.handleDeletedAsset.bind(this));

    ['insert', 'update', 'delete'].forEach(action => { // note we just log any errors
      const hookName = `post${action[0].toUpperCase()}${action.slice(1)}Hook`;
      this.content[hookName].tap(async (...args) => {
        try {
          await this.handleContentEvent(action, ...args).catch(e => this.log('error', e));
        } catch(e) {
          this.log('error', 'COURSEASSETS_UPDATE', e);
        }
      });
    });
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
      } else if(val?._backboneForms?.type === "Asset" || val?._backboneForms === "Asset") {
        assets.push(data[key].toString());
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
    if(action === 'delete') {
      return Promise.all((Array.isArray(arg1) ? arg1 : [arg1]).map(async c => {
        await this.deleteMany({ contentId: c._id });
        this.log('debug', 'DELETE', c._courseId.toString(), c._id.toString());
      }));
    }
    const type = arg1._type;
    const contentId = arg1._id.toString();
    const courseId = arg1._courseId?.toString() ?? type === 'course' ? contentId : undefined;
    const isModify = action === 'update';
    
    if(!contentId || !courseId) {
      return;
    }
    // delete any existing course assets for content
    await this.deleteMany({ courseId, contentId });

    const data = isModify ? arg2 : arg1;
    const schema = await this.content.getSchema(await this.content.getSchemaName(data), courseId);
    const ids = this.extractAssetIds(schema.built.properties, data);
    
    if(!ids.length) {
      return;
    }
    await Promise.all(ids.map(async _id => {
      const [asset] = await this.assets.find({ _id });
      if(!asset) {
        throw this.app.errors.NOT_FOUND.setData({ type: 'asset', id: _id });
      }
      await this.insert({ courseId, contentId, assetId: _id });
    }));
    this.log('debug', 'UPDATE', courseId, contentId);
  }

  async handleDeletedAsset(asset) {
    const results = await this.find({ assetId: asset._id });
    if(!results.length) {
      return;
    }
    const courses = (await this.content.find({ _id: { $in: results.map(r => r.courseId) } }))
      .map(c => c.displayTitle || c.title);

    throw this.app.errors.RESOURCE_IN_USE.setData({ type: 'asset', courses });
  }
}

export default CourseAssetsModule;