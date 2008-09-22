function DiscoCacheEntry(jid, node, isCapsNode)
{
    if (isCapsNode) {
        if (this.capsCache[node])
            return this.capsCache[node];
        this.capsCache[node] = this;
    } else {
        var id = jid + (node ? "#"+node : "");
        if (this.cache[id])
            return this.cache[id];
        this.cache[id] = this;
    }

    this.jid = jid;
    this.node = node;
    this._isCapsNode = isCapsNode;

    return this;
}

_DECL_(DiscoCacheEntry).prototype =
{
    cache: {},
    capsCache: {},

    requestDiscoInfo: function(featureName, forceUpdate, callback, discoItem)
    {
        if (!this.discoInfo)
            if (this.capsNode) {
                this._populateDiscoInfoFromCaps(featureName, callback, discoItem);
                if (!this.discoInfo)
                    return null;
            } else if (this._isCapsNode)
                this._populateDiscoInfoFromCapsCache();

        if (!callback)
            return this._feature(featureName);

        if (!this.discoInfo || (!this.capsNode && !this._isCapsNode && forceUpdate)) {
            if (!this.discoInfoCallbacks) {
                var iq = new JSJaCIQ();
                iq.setIQ(this.jid, "get");
                iq.setQuery("http://jabber.org/protocol/disco#info");
                if (this.node)
                    iq.getQuery().setAttribute("node", this.node);
                con.send(iq, function(pkt, _this) { _this._gotDiscoInfo(pkt) }, this);
                this.discoInfoCallbacks = [[featureName, callback, discoItem]];
            } else
                this.discoInfoCallbacks.push([featureName, callback, discoItem]);
            return null;
        }
        callback(discoItem, this._feature(featureName));

        return this._feature(featureName);
    },

    requestDiscoItems: function(forceUpdate, callback, discoItem)
    {
        if (!callback)
            return this.discoItems;

        if (!this.discoItems || forceUpdate) {
            if (!this.discoItemsCallbacks) {
                var iq = new JSJaCIQ();
                iq.setIQ(this.jid, "get");
                iq.setQuery("http://jabber.org/protocol/disco#items");
                if (this.node)
                    iq.getQuery().setAttribute("node", this.node);
                con.send(iq, function(pkt, _this) { _this._gotDiscoItems(pkt) }, this);
                this.discoItemsCallbacks = [[callback, discoItem]];
            } else
                this.discoItemsCallbacks.push([callback, discoItem]);
            return null;
        }
        callback(discoItem, this.discoItems);

        return this.discoItems;
    },

    updateCapsInfo: function(caps)
    {
        var [node, ver, ext] = [this.capsNode, this.capsVer, this.capsExt];

        this.capsNode = caps.getAttribute("node");
        this.capsVer = caps.getAttribute("ver");
        this.capsExt = (caps.getAttribute("ext") || "").split(/\s+/);

        if (node != this.capsNode || ver != this.capsVer ||
            ext.sort().join(" ") != this.capsExt.sort().join(" "))
            this.discoInfo = null;
    },

    destroy: function()
    {
        if (!this._isCapsNode)
            delete this.cache[this.jid + (this.node ? "" : "#"+this.node)];
    },

    _feature: function(featureName)
    {
        if (!this.discoInfo)
            return null;
        if (featureName == null)
            return this.discoInfo;
        if (featureName == "")
            return this.discoInfo.identities;
        return featureName in this.discoInfo.features;
    },

    _populateDiscoInfoFromCaps: function(featureName, callback, discoItem)
    {
        var nodes = [this.capsVer].concat(this.capsExt);
        var infos = [];
        var capsCallback, capsCallbackData;

        for (var i = 0; i < nodes.length; i++) {
            var ce = new DiscoCacheEntry(this.jid, this.capsNode+"#"+nodes[i],
                                         true);
            var info = ce.requestDiscoInfo();
            if (info) {
                if (infos.length == i)
                    infos.push(info);
            } else {
                if (!capsCallback)
                    capsCallback = new Callback(this._gotCapsInfo, this).
                        addArgs(capsCallbackData = {}, featureName, callback, discoItem);
                capsCallbackData[this.capsNode+"#"+nodes[i]] = 1;
                ce.requestDiscoInfo(null, false, capsCallback);
            }
        }

        if (infos.length == nodes.length) {
            this.discoInfo = {
                identities: infos[0].identities,
                features: {}
            }
            for (var i = 0; i < infos.length; i++)
                for (var j in infos[i].features)
                    this.discoInfo.features[j] = 1
        }
    },

    _populateDiscoInfoFromCapsCache: function()
    {
        var s = account.cache.getValue("caps-"+this.node);

        if (s == null)
            return;

        s = s.split("\n");
        this.discoInfo = { features: {} };
        account.cache.bumpExpirationDate("caps-"+this.node,
                                         new Date(Date.now()+30*24*60*60*1000));
        var idx = 0, count = 1;
        if (+s[0] > 0) {
            idx = 1;
            count = +s[0];
        }

        this.discoInfo.identities = [];
        for (var i = 0; i < count; i++) {
            if (s[idx] || s[idx+1] || s[idx+2])
                this.discoInfo.identities.push({
                    name: s[idx],
                    type: s[idx+1],
                    category: s[idx+2]
                });
            idx += 3;
        }

        for (i = idx; i < s.length; i++)
            this.discoInfo.features[s[i]] = 1;
    },

    _gotDiscoInfo: function(pkt)
    {
        var features = pkt.getQuery().getElementsByTagName("feature");
        var identities = pkt.getQuery().getElementsByTagName("identity");
        var cacheVal = "";

        this.discoInfo = { identities: [], features: {} };

        if (identities.length)
            for (var i = 0; i < identities.length; i++) {
                var ident = {
                    name: identities[i].getAttribute("name") || "",
                    type: identities[i].getAttribute("type") || "",
                    category: identities[i].getAttribute("category") || ""
                }
                this.discoInfo.identities.push(ident);
                if (this._isCapsNode)
                    cacheVal += "\n"+ident.name+"\n"+ident.type+"\n"+ident.category;
            }
        cacheVal = this.discoInfo.identities.length + cacheVal;

        for (i = 0; i < features.length; i++) {
            var feature = features[i].getAttribute("var");
            this.discoInfo.features[feature] = 1;
            if (this._isCapsNode)
                cacheVal += "\n" + feature;
        }

        for (i = 0; i < this.discoInfoCallbacks.length; i++) {
            var [featureName, callback, discoItem] = this.discoInfoCallbacks[i];
            callback(discoItem, this._feature(featureName));
        }

        if (this._isCapsNode)
            account.cache.setValue("caps-"+this.node, cacheVal,
                                   new Date(Date.now()+30*24*60*60*1000));

        delete this.discoInfoCallbacks;
    },

    _gotDiscoItems: function(pkt)
    {
        var items = pkt.getQuery().
            getElementsByTagNameNS("http://jabber.org/protocol/disco#items", "item");

        this.discoItems = [];
        for (var i = 0; i < items.length; i++)
            this.discoItems.push(new DiscoItem(items[i].getAttribute("jid"),
                                               items[i].getAttribute("name"),
                                               items[i].getAttribute("node")));

        for (var i = 0; i < this.discoItemsCallbacks.length; i++) {
            var [callback, discoInfo] = this.discoItemsCallbacks[i];
            callback.call(null, discoInfo, this.discoItems);
        }

        delete this.discoItemsCallbacks;
    },

    _gotCapsInfo: function(capsItem, info, nodes, featureName, callback, discoItem)
    {
        delete nodes[discoItem.node];
        if (nodes.__count__ != 0)
            return;

        this._populateDiscoInfoFromCaps();
        if (callback)
            callback(discoItem, this._feature(featureName));
    }
}

function DiscoItem(jid, name, node)
{
    this.discoJID = jid;
    this.discoName = name;
    this.discoNode = node;
}

_DECL_(DiscoItem).prototype =
{
    get _discoCacheEntry()
    {
        return META.ACCESSORS.replace(this, "_discoCacheEntry",
            new DiscoCacheEntry(this.discoJID || this.jid, this.discoNode));
    },

    updateCapsInfo: function(node)
    {
        this._discoCacheEntry.updateCapsInfo(node);
    },

    hasCapsInformations: function()
    {
        return this._discoCacheEntry.capsNode != null;
    },

    /**
     * Check if given disco item report feature <em>name</em> as implemented.
     *
     * @param name {String}  name of feature to check.
     * @param forceUpdate {bool}  if <code>true</code> no cached result will be
     *   reused.
     * @param callback {Function}  callback which will be called when enough
     *   informations will be available. Callback will be called with two
     *   arguments, refence to object on which <code>hasDiscoFeature</code> has
     *   been called and boolean value indicating that given feature is or
     *   isn't implemented.
     *
     * @returns {bool} <code>true</code> if feature <em>name</em> is
     *   implemented, <code>false</code> if not, and <code>null</code> if
     *   this information is not yet available.
     */
    hasDiscoFeature: function(name, forceUpdate, callback)
    {
        return this._discoCacheEntry.requestDiscoInfo(name, forceUpdate, callback, this);
    },

    getDiscoIdentities: function(forceUpdate, callback)
    {
        return this._discoCacheEntry.requestDiscoInfo("", forceUpdate, callback, this);
    },

    getDiscoInfo: function(forceUpdate, callback)
    {
        return this._discoCacheEntry.requestDiscoInfo(null, forceUpdate, callback, this);
    },

    getDiscoItems: function(forceUpdate, callback)
    {
        return this._discoCacheEntry.requestDiscoItems(forceUpdate, callback, this);
    },

    getDiscoItemsByCategory: function(category, type, forceUpdate, callback)
    {
        if (callback)
            this.getDiscoItems(forceUpdate, new Callback(this._gotDiscoItems, this).
                addArgs(null, category, type, forceUpdate, callback));

        var items = this.getDiscoItems(), ret = [];
        if (!items)
            return ret;

        for (var i = 0; i < items.length; i++) {
            var id = items[i].getDiscoIdentities();
            for (var j = 0; j < id.length; j++)
                if ((category == null || id[j].category == category) &&
                    (type == null || id[j].type == type))
                {
                    ret.push(items[i]);
                    break;
                }
        }
        return ret;
    },

    getDiscoItemsByFeature: function(feature, forceUpdate, callback)
    {
        if (callback)
            this.getDiscoItems(forceUpdate, new Callback(this._gotDiscoItems, this).
                addArgs(feature, null, null, forceUpdate, callback));

        var items = this.getDiscoItems(), ret = [];
        if (!items)
            return ret;

        for (var i = 0; i < items.length; i++) {
            var id = items[i].getDiscoInfo();
            if (id && (feature in id.features))
                ret.push(items[i]);
        }
        return ret;
    },

    _gotDiscoItems: function(discoItem, items, feature, category, type, forceUpdate, callback)
    {
        for (var i = 0; i < items.length; i++)
            if (!items[i].node)
                items[i].getDiscoIdentities(forceUpdate, new Callback(this._gotDiscoIdentities, this).
                    addArgs(feature, category, type, callback));
    },

    _gotDiscoIdentities: function(discoItem, id, feature, category, type, callback)
    {
        if (!id)
            return;

        if (feature) {
            if (feature in discoItem._discoCacheEntry.discoInfo.features)
                callback(this, this.getDiscoItemsByFeature(feature), discoItem);
        } else {
            for (var i = 0; i < id.length; i++)
                if ((category == null || id[i].category == category) &&
                    (type == null || id[i].type == type))
                {
                    callback(this, this.getDiscoItemsByCategory(category, type), discoItem);
                    break;
                }
        }
    }
}

function cleanDiscoCache()
{
    DiscoCacheEntry.prototype.cache = {};
}
