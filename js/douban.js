// 豆瓣热门电影电视剧推荐功能

// 豆瓣标签列表 - 修改为默认标签
let defaultMovieTags = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '日综', '爱情', '科幻', '悬疑', '恐怖', '治愈'];
let defaultTvTags = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];

// 用户标签列表 - 存储用户实际使用的标签（包含保留的系统标签和用户添加的自定义标签）
let movieTags = [];
let tvTags = [];

// 加载用户标签
function loadUserTags() {
    try {
        // 尝试从本地存储加载用户保存的标签
        const savedMovieTags = localStorage.getItem('userMovieTags');
        const savedTvTags = localStorage.getItem('userTvTags');
        
        // 如果本地存储中有标签数据，则使用它
        if (savedMovieTags) {
            movieTags = JSON.parse(savedMovieTags);
        } else {
            // 否则使用默认标签
            movieTags = [...defaultMovieTags];
        }
        
        if (savedTvTags) {
            tvTags = JSON.parse(savedTvTags);
        } else {
            // 否则使用默认标签
            tvTags = [...defaultTvTags];
        }
    } catch (e) {
        console.error('加载标签失败：', e);
        // 初始化为默认值，防止错误
        movieTags = [...defaultMovieTags];
        tvTags = [...defaultTvTags];
    }
}

// 保存用户标签
function saveUserTags() {
    try {
        localStorage.setItem('userMovieTags', JSON.stringify(movieTags));
        localStorage.setItem('userTvTags', JSON.stringify(tvTags));
    } catch (e) {
        console.error('保存标签失败：', e);
        showToast('保存标签失败', 'error');
    }
}

let doubanMovieTvCurrentSwitch = 'movie';
let doubanCurrentTag = '热门';
let doubanPageStart = 0;
const doubanPageSize = 16; // 一次显示的项目数量
let doubanContentRequested = false;
let doubanLazyObserver = null;
let doubanRenderGeneration = 0;
let doubanUiInitialized = false;
let doubanRecommendAbortController = null;
let doubanRecommendLoading = false;
const DOUBAN_COVER_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function resetDoubanLazyState() {
    doubanContentRequested = false;
    if (doubanLazyObserver) {
        doubanLazyObserver.disconnect();
        doubanLazyObserver = null;
    }
}

// 等页面资源加载完成后再请求豆瓣，避免首屏与封面代理抢连接
function runDoubanLoadWhenReady(callback) {
    if (document.readyState === 'complete') {
        setTimeout(callback, 50);
    } else {
        window.addEventListener('load', () => setTimeout(callback, 50), { once: true });
    }
}

// 滚动到豆瓣区域附近再加载，减少首页首屏代理请求
function scheduleDoubanLoad() {
    if (doubanContentRequested) return;

    const doubanArea = document.getElementById('doubanArea');
    if (!doubanArea || doubanArea.classList.contains('hidden')) return;

    const startLoad = () => {
        if (doubanContentRequested) return;
        doubanContentRequested = true;
        if (doubanLazyObserver) {
            doubanLazyObserver.disconnect();
            doubanLazyObserver = null;
        }
        renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
    };

    const queueStart = () => runDoubanLoadWhenReady(startLoad);

    const rect = doubanArea.getBoundingClientRect();
    if (rect.top <= window.innerHeight + 200) {
        queueStart();
        return;
    }

    if (!('IntersectionObserver' in window)) {
        queueStart();
        return;
    }

    doubanLazyObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                queueStart();
                break;
            }
        }
    }, { rootMargin: '200px 0px' });

    doubanLazyObserver.observe(doubanArea);
}

// 初始化豆瓣功能（UI 只绑定一次）
function initDoubanUiOnce() {
    if (doubanUiInitialized) return;
    doubanUiInitialized = true;

    const doubanToggle = document.getElementById('doubanToggle');
    if (doubanToggle) {
        doubanToggle.addEventListener('change', function(e) {
            const isChecked = e.target.checked;
            localStorage.setItem('doubanEnabled', isChecked);

            const toggleBg = doubanToggle.nextElementSibling;
            const toggleDot = toggleBg?.nextElementSibling;
            if (toggleBg && toggleDot) {
                if (isChecked) {
                    toggleBg.classList.add('bg-pink-600');
                    toggleDot.classList.add('translate-x-6');
                } else {
                    toggleBg.classList.remove('bg-pink-600');
                    toggleDot.classList.remove('translate-x-6');
                }
            }

            resetDoubanLazyState();
            updateDoubanVisibility();
        });
    }

    loadUserTags();
    renderDoubanMovieTvSwitch();
    renderDoubanTags();
    setupDoubanRefreshBtn();
}

function syncDoubanToggleUi() {
    const doubanToggle = document.getElementById('doubanToggle');
    if (!doubanToggle) return;

    const isEnabled = localStorage.getItem('doubanEnabled') === 'true';
    doubanToggle.checked = isEnabled;

    const toggleBg = doubanToggle.nextElementSibling;
    const toggleDot = toggleBg?.nextElementSibling;
    if (toggleBg && toggleDot) {
        if (isEnabled) {
            toggleBg.classList.add('bg-pink-600');
            toggleDot.classList.add('translate-x-6');
        } else {
            toggleBg.classList.remove('bg-pink-600');
            toggleDot.classList.remove('translate-x-6');
        }
    }
}

// 在 app.js 完成默认配置、或密码验证通过后调用
function bootstrapDouban() {
    initDoubanUiOnce();
    syncDoubanToggleUi();
    resetDoubanLazyState();
    updateDoubanVisibility();
}

function initDouban() {
    bootstrapDouban();
}

// 兼容旧调用
window.bootstrapDouban = bootstrapDouban;
window.initDouban = initDouban;

// 根据设置更新豆瓣区域的显示状态
function updateDoubanVisibility() {
    const doubanArea = document.getElementById('doubanArea');
    if (!doubanArea) return;

    if (window.isPasswordProtected?.() && !window.isPasswordVerified?.()) {
        doubanArea.classList.add('hidden');
        return;
    }
    
    const isEnabled = localStorage.getItem('doubanEnabled') === 'true';
    const isSearching = document.getElementById('resultsArea') && 
        !document.getElementById('resultsArea').classList.contains('hidden');
    
    // 只有在启用且没有搜索结果显示时才显示豆瓣区域
    if (isEnabled && !isSearching) {
        doubanArea.classList.remove('hidden');
        const resultsEl = document.getElementById('douban-results');
        if (resultsEl && resultsEl.children.length === 0) {
            scheduleDoubanLoad();
        }
    } else {
        doubanArea.classList.add('hidden');
        resetDoubanLazyState();
    }

    updateHomeLayout();
}

function updateHomeLayout() {
    const searchArea = document.getElementById('searchArea');
    const resultsArea = document.getElementById('resultsArea');
    if (!searchArea) return;

    const isSearching = resultsArea && !resultsArea.classList.contains('hidden');
    const doubanEnabled = localStorage.getItem('doubanEnabled') === 'true';

    if (isSearching) {
        searchArea.classList.remove('flex-1', 'justify-center', 'home-search-top');
        searchArea.classList.add('mb-8');
    } else if (doubanEnabled) {
        searchArea.classList.remove('flex-1', 'justify-center', 'mb-8');
        searchArea.classList.add('home-search-top');
    } else {
        searchArea.classList.add('flex-1', 'justify-center');
        searchArea.classList.remove('home-search-top', 'mb-8');
    }
}

function showDoubanLoading(show) {
    const loading = document.getElementById('douban-loading');
    if (!loading) return;
    loading.classList.toggle('hidden', !show);
    loading.classList.toggle('flex', show);
}

function revokeDoubanObjectUrls(container) {
    if (!container) return;
    container.querySelectorAll('img').forEach((img) => {
        if (img._doubanObjectUrl) {
            URL.revokeObjectURL(img._doubanObjectUrl);
            img._doubanObjectUrl = null;
        }
    });
}

window.updateHomeLayout = updateHomeLayout;

// 只填充搜索框，不执行搜索，让用户自主决定搜索时机
function fillSearchInput(title) {
    if (!title) return;
    
    // 安全处理标题，防止XSS
    const safeTitle = title
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;
        
        // 聚焦搜索框，便于用户立即使用键盘操作
        input.focus();
        
        // 显示一个提示，告知用户点击搜索按钮进行搜索
        showToast('已填充搜索内容，点击搜索按钮开始搜索', 'info');
    }
}

// 填充搜索框并执行搜索
function fillAndSearch(title) {
    if (!title) return;
    
    // 安全处理标题，防止XSS
    const safeTitle = title
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;
        search(); // 使用已有的search函数执行搜索
        
        // 同时更新浏览器URL，使其反映当前的搜索状态
        try {
            // 使用URI编码确保特殊字符能够正确显示
            const encodedQuery = encodeURIComponent(safeTitle);
            // 使用HTML5 History API更新URL，不刷新页面
            window.history.pushState(
                { search: safeTitle }, 
                `搜索: ${safeTitle} - FreeTV`, 
                `/s=${encodedQuery}`
            );
            // 更新页面标题
            document.title = `搜索: ${safeTitle} - FreeTV`;
        } catch (e) {
            console.error('更新浏览器历史失败:', e);
        }
    }
}

// 填充搜索框，确保豆瓣资源API被选中，然后执行搜索
async function fillAndSearchWithDouban(title) {
    if (!title) return;
    
    // 安全处理标题，防止XSS
    const safeTitle = title
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    
    // 确保豆瓣资源API被选中
    if (typeof selectedAPIs !== 'undefined' && !selectedAPIs.includes('dbzy')) {
        // 在设置中勾选豆瓣资源API复选框
        const doubanCheckbox = document.querySelector('input[id="api_dbzy"]');
        if (doubanCheckbox) {
            doubanCheckbox.checked = true;
            
            // 触发updateSelectedAPIs函数以更新状态
            if (typeof updateSelectedAPIs === 'function') {
                updateSelectedAPIs();
            } else {
                // 如果函数不可用，则手动添加到selectedAPIs
                selectedAPIs.push('dbzy');
                localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));
                
                // 更新选中API计数（如果有这个元素）
                const countEl = document.getElementById('selectedAPICount');
                if (countEl) {
                    countEl.textContent = selectedAPIs.length;
                }
            }
            
            showToast('已自动选择豆瓣资源API', 'info');
        }
    }
    
    // 填充搜索框并执行搜索
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;
        await search(); // 使用已有的search函数执行搜索
        
        // 更新浏览器URL，使其反映当前的搜索状态
        try {
            // 使用URI编码确保特殊字符能够正确显示
            const encodedQuery = encodeURIComponent(safeTitle);
            // 使用HTML5 History API更新URL，不刷新页面
            window.history.pushState(
                { search: safeTitle }, 
                `搜索: ${safeTitle} - FreeTV`, 
                `/s=${encodedQuery}`
            );
            // 更新页面标题
            document.title = `搜索: ${safeTitle} - FreeTV`;
        } catch (e) {
            console.error('更新浏览器历史失败:', e);
        }

        if (window.innerWidth <= 768) {
          window.scrollTo({
              top: 0,
              behavior: 'smooth'
          });
        }
    }
}

// 渲染电影/电视剧切换器
function renderDoubanMovieTvSwitch() {
    // 获取切换按钮元素
    const movieToggle = document.getElementById('douban-movie-toggle');
    const tvToggle = document.getElementById('douban-tv-toggle');

    if (!movieToggle ||!tvToggle) return;

    movieToggle.addEventListener('click', function() {
        if (doubanMovieTvCurrentSwitch !== 'movie') {
            // 更新按钮样式
            movieToggle.classList.add('bg-pink-600', 'text-white');
            movieToggle.classList.remove('text-gray-300');
            
            tvToggle.classList.remove('bg-pink-600', 'text-white');
            tvToggle.classList.add('text-gray-300');
            
            doubanMovieTvCurrentSwitch = 'movie';
            doubanCurrentTag = '热门';

            // 重新加载豆瓣内容
            renderDoubanTags(movieTags);

            // 换一批按钮事件监听
            setupDoubanRefreshBtn();
            
            // 初始加载热门内容
            if (localStorage.getItem('doubanEnabled') === 'true') {
                renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
            }
        }
    });
    
    // 电视剧按钮点击事件
    tvToggle.addEventListener('click', function() {
        if (doubanMovieTvCurrentSwitch !== 'tv') {
            // 更新按钮样式
            tvToggle.classList.add('bg-pink-600', 'text-white');
            tvToggle.classList.remove('text-gray-300');
            
            movieToggle.classList.remove('bg-pink-600', 'text-white');
            movieToggle.classList.add('text-gray-300');
            
            doubanMovieTvCurrentSwitch = 'tv';
            doubanCurrentTag = '热门';

            // 重新加载豆瓣内容
            renderDoubanTags(tvTags);

            // 换一批按钮事件监听
            setupDoubanRefreshBtn();
            
            // 初始加载热门内容
            if (localStorage.getItem('doubanEnabled') === 'true') {
                renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
            }
        }
    });
}

// 渲染豆瓣标签选择器
function renderDoubanTags(tags) {
    const tagContainer = document.getElementById('douban-tags');
    if (!tagContainer) return;
    
    // 确定当前应该使用的标签列表
    const currentTags = doubanMovieTvCurrentSwitch === 'movie' ? movieTags : tvTags;
    
    // 清空标签容器
    tagContainer.innerHTML = '';

    // 先添加标签管理按钮
    const manageBtn = document.createElement('button');
    manageBtn.className = 'py-1.5 px-3.5 rounded text-sm font-medium transition-all duration-300 bg-[#1a1a1a] text-gray-300 hover:bg-pink-700 hover:text-white border border-[#333] hover:border-white';
    manageBtn.innerHTML = '<span class="flex items-center"><svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>管理标签</span>';
    manageBtn.onclick = function() {
        showTagManageModal();
    };
    tagContainer.appendChild(manageBtn);

    // 添加所有标签
    currentTags.forEach(tag => {
        const btn = document.createElement('button');
        
        // 设置样式
        let btnClass = 'py-1.5 px-3.5 rounded text-sm font-medium transition-all duration-300 border ';
        
        // 当前选中的标签使用高亮样式
        if (tag === doubanCurrentTag) {
            btnClass += 'bg-pink-600 text-white shadow-md border-white';
        } else {
            btnClass += 'bg-[#1a1a1a] text-gray-300 hover:bg-pink-700 hover:text-white border-[#333] hover:border-white';
        }
        
        btn.className = btnClass;
        btn.textContent = tag;
        
        btn.onclick = function() {
            if (doubanCurrentTag !== tag) {
                doubanCurrentTag = tag;
                doubanPageStart = 0;
                renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
                renderDoubanTags();
            }
        };
        
        tagContainer.appendChild(btn);
    });
}

// 设置换一批按钮事件
function setupDoubanRefreshBtn() {
    const btn = document.getElementById('douban-refresh');
    if (!btn) return;
    
    btn.onclick = function() {
        if (doubanRecommendLoading) return;

        doubanPageStart += doubanPageSize;
        if (doubanPageStart > 9 * doubanPageSize) {
            doubanPageStart = 0;
        }
        
        renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
    };
}

function setDoubanRefreshBusy(busy) {
    doubanRecommendLoading = busy;
    const btn = document.getElementById('douban-refresh');
    if (!btn) return;
    btn.disabled = busy;
    btn.classList.toggle('opacity-50', busy);
    btn.classList.toggle('cursor-not-allowed', busy);
}

function cancelContainerImageLoads(container) {
    if (!container) return;
    container.querySelectorAll('img[data-cover]').forEach((img) => {
        img.src = DOUBAN_COVER_PLACEHOLDER;
    });
}

function fetchDoubanTags() {
    const movieTagsTarget = `https://movie.douban.com/j/search_tags?type=movie`
    fetchDoubanData(movieTagsTarget)
        .then(data => {
            movieTags = data.tags;
            if (doubanMovieTvCurrentSwitch === 'movie') {
                renderDoubanTags(movieTags);
            }
        })
        .catch(error => {
            console.error("获取豆瓣热门电影标签失败：", error);
        });
    const tvTagsTarget = `https://movie.douban.com/j/search_tags?type=tv`
    fetchDoubanData(tvTagsTarget)
       .then(data => {
            tvTags = data.tags;
            if (doubanMovieTvCurrentSwitch === 'tv') {
                renderDoubanTags(tvTags);
            }
        })
       .catch(error => {
            console.error("获取豆瓣热门电视剧标签失败：", error);
        });
}

// 渲染热门推荐内容
function renderRecommend(tag, pageLimit, pageStart) {
    const container = document.getElementById("douban-results");
    if (!container) return;

    if (doubanRecommendAbortController) {
        doubanRecommendAbortController.abort();
    }
    doubanRecommendAbortController = new AbortController();

    const generation = ++doubanRenderGeneration;
    cancelContainerImageLoads(container);
    setDoubanRefreshBusy(true);
    showDoubanLoading(true);
    
    const target = `https://movie.douban.com/j/search_subjects?type=${doubanMovieTvCurrentSwitch}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`;
    
    fetchDoubanData(target, { signal: doubanRecommendAbortController.signal })
        .then(async (data) => {
            if (generation !== doubanRenderGeneration) return;
            showDoubanLoading(false);
            if (!data) {
                revokeDoubanObjectUrls(container);
                container.innerHTML = `
                    <div class="col-span-full text-center py-8">
                        <div class="text-red-400">❌ 获取豆瓣数据失败，请稍后重试</div>
                    </div>
                `;
                return;
            }
            await renderDoubanCards(data, container, generation);
        })
        .catch(error => {
            if (generation !== doubanRenderGeneration || error.name === 'AbortError') return;
            console.error("获取豆瓣数据失败：", error);
            showDoubanLoading(false);
            revokeDoubanObjectUrls(container);
            container.innerHTML = `
                <div class="col-span-full text-center py-8">
                    <div class="text-red-400">❌ 获取豆瓣数据失败，请稍后重试</div>
                    <div class="text-gray-500 text-sm mt-2">提示：使用VPN可能有助于解决此问题</div>
                </div>
            `;
        })
        .finally(() => {
            if (generation === doubanRenderGeneration) {
                setDoubanRefreshBusy(false);
            }
        });
}

async function fetchDoubanData(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    if (options.signal) {
        if (options.signal.aborted) {
            clearTimeout(timeoutId);
            throw new DOMException('Aborted', 'AbortError');
        }
        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    
    const fetchOptions = {
        signal: controller.signal,
        credentials: 'same-origin',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Referer': 'https://movie.douban.com/',
            'Accept': 'application/json, text/plain, */*',
        }
    };

    try {
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ? 
            await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(url)) :
            PROXY_URL + encodeURIComponent(url);
            
        const response = await fetch(proxiedUrl, fetchOptions);
        clearTimeout(timeoutId);

        if (response.status === 429 && typeof handleRateLimitResponse === 'function' && await handleRateLimitResponse(response)) {
            return null;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        return await response.json();
    } catch (err) {
        clearTimeout(timeoutId);

        if (err.name === 'AbortError') {
            throw err;
        }

        console.error("豆瓣 API 请求失败（直接代理）：", err);
        
        const fallbackUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
        
        try {
            const fallbackResponse = await fetch(fallbackUrl);
            
            if (!fallbackResponse.ok) {
                throw new Error(`备用API请求失败! 状态: ${fallbackResponse.status}`);
            }
            
            const data = await fallbackResponse.json();
            
            if (data && data.contents) {
                return JSON.parse(data.contents);
            }
            throw new Error("无法获取有效数据");
        } catch (fallbackErr) {
            if (fallbackErr.name === 'AbortError') {
                throw fallbackErr;
            }
            console.error("豆瓣 API 备用请求也失败：", fallbackErr);
            throw fallbackErr;
        }
    }
}

function escapeHtmlAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildDoubanCoverUrl(coverUrl) {
    if (!coverUrl) return '';
    // 封面走 img 标签 + HttpOnly cookie 鉴权，不加 auth&t= 避免破坏浏览器/Edge 缓存
    return PROXY_URL + encodeURIComponent(coverUrl);
}

function loadCoverViaImg(img, proxiedUrl, isStale) {
    return new Promise((resolve, reject) => {
        const onLoad = () => {
            cleanup();
            if (isStale?.()) return resolve();
            resolve();
        };
        const onError = () => {
            cleanup();
            if (isStale?.()) return resolve();
            reject(new Error('img load failed'));
        };
        const cleanup = () => {
            img.removeEventListener('load', onLoad);
            img.removeEventListener('error', onError);
        };
        img.addEventListener('load', onLoad);
        img.addEventListener('error', onError);
        img.src = proxiedUrl;
    });
}

async function assignDoubanCoverViaFetch(img, coverUrl) {
    const proxied = buildDoubanCoverUrl(coverUrl);
    const response = await fetch(proxied, { credentials: 'same-origin' });

    if (typeof handleRateLimitResponse === 'function' && await handleRateLimitResponse(response)) {
        throw new Error('rate limited');
    }
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
        throw new Error(`Invalid content type: ${contentType}`);
    }

    const blob = await response.blob();
    if (!blob.size) {
        throw new Error('Empty image');
    }

    if (img._doubanObjectUrl) {
        URL.revokeObjectURL(img._doubanObjectUrl);
    }
    img._doubanObjectUrl = URL.createObjectURL(blob);
    img.src = img._doubanObjectUrl;
}

async function loadSingleDoubanCover(img, generation) {
    if (generation !== doubanRenderGeneration) return;

    const cover = img.dataset.cover;
    if (!cover) return;

    const isStale = () => generation !== doubanRenderGeneration || !img.isConnected;
    img.dataset.retryCount = '0';
    const proxied = buildDoubanCoverUrl(cover);

    try {
        await loadCoverViaImg(img, proxied, isStale);
    } catch (error) {
        if (isStale()) return;
        await retryDoubanCoverAsync(img, generation);
    }
}

async function retryDoubanCoverAsync(img, generation, maxRetries = 3) {
    const cover = img.dataset.cover;
    if (!cover || !img.isConnected) return;
    if (generation !== undefined && generation !== doubanRenderGeneration) return;

    const retryCount = parseInt(img.dataset.retryCount || '0', 10);
    if (retryCount >= maxRetries) return;

    img.dataset.retryCount = String(retryCount + 1);
    await new Promise((resolve) => setTimeout(resolve, 200 * retryCount));

    if (!img.isConnected || generation !== undefined && generation !== doubanRenderGeneration) return;

    try {
        await assignDoubanCoverViaFetch(img, cover);
    } catch (error) {
        console.warn('豆瓣封面重试失败:', cover, error.message);
        if (retryCount + 1 < maxRetries) {
            await retryDoubanCoverAsync(img, generation, maxRetries);
        }
    }
}

window.retryDoubanCover = function(img) {
    if (!img || img._doubanRetrying) return;
    img._doubanRetrying = true;
    retryDoubanCoverAsync(img, undefined)
        .catch(() => {})
        .finally(() => {
            img._doubanRetrying = false;
        });
};

async function loadDoubanCoversInBatches(container, generation) {
    const imgs = Array.from(container.querySelectorAll('img[data-cover]'));
    await Promise.allSettled(imgs.map((img) => loadSingleDoubanCover(img, generation)));
}

// 抽取渲染豆瓣卡片的逻辑到单独函数
async function renderDoubanCards(data, container, generation) {
    if (generation !== doubanRenderGeneration) return;

    const fragment = document.createDocumentFragment();
    
    if (!data || !data.subjects || data.subjects.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "col-span-full text-center py-8";
        emptyEl.innerHTML = `
            <div class="text-pink-500">❌ 暂无数据，请尝试其他分类或刷新</div>
        `;
        fragment.appendChild(emptyEl);
    } else {
        for (const item of data.subjects) {
            const card = document.createElement("div");
            card.className = "bg-[#111] hover:bg-[#222] transition-all duration-300 rounded-lg overflow-hidden flex flex-col transform hover:scale-105 shadow-md hover:shadow-lg";
            
            const safeTitle = item.title
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
            
            const safeRate = (item.rate || "暂无")
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            const safeCover = escapeHtmlAttr(item.cover || '');
            
            card.innerHTML = `
                <div class="relative w-full aspect-[2/3] overflow-hidden cursor-pointer bg-[#1a1a1a]" onclick="fillAndSearchWithDouban('${safeTitle}')">
                    <img src="${DOUBAN_COVER_PLACEHOLDER}" data-cover="${safeCover}" alt="${safeTitle}" 
                        class="w-full h-full object-cover transition-transform duration-500 hover:scale-110"
                        loading="eager"
                        decoding="async">
                    <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent opacity-60 pointer-events-none"></div>
                    <div class="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded-sm">
                        <span class="text-yellow-400">★</span> ${safeRate}
                    </div>
                    <div class="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded-sm hover:bg-[#333] transition-colors">
                        <a href="${item.url}" target="_blank" rel="noopener noreferrer" title="在豆瓣查看" onclick="event.stopPropagation();">
                            🔗
                        </a>
                    </div>
                </div>
                <div class="p-2 text-center bg-[#111]">
                    <button onclick="fillAndSearchWithDouban('${safeTitle}')" 
                            class="text-sm font-medium text-white truncate w-full hover:text-pink-400 transition"
                            title="${safeTitle}">
                        ${safeTitle}
                    </button>
                </div>
            `;
            
            fragment.appendChild(card);
        }
    }
    
    revokeDoubanObjectUrls(container);
    cancelContainerImageLoads(container);
    container.innerHTML = "";
    container.appendChild(fragment);

    if (data?.subjects?.length) {
        loadDoubanCoversInBatches(container, generation);
    }
}

// 重置到首页
function resetToHome() {
    resetSearchArea();
    updateDoubanVisibility();
}

// 由 app.js / password.js 在配置就绪后调用 bootstrapDouban()
document.addEventListener('passwordVerified', () => {
    if (window.ProxyAuth?.clearAuthCache) {
        window.ProxyAuth.clearAuthCache();
    }
    const resultsEl = document.getElementById('douban-results');
    if (resultsEl) {
        revokeDoubanObjectUrls(resultsEl);
        resultsEl.innerHTML = '';
    }
    resetDoubanLazyState();
    bootstrapDouban();
});

// 显示标签管理模态框
function showTagManageModal() {
    // 确保模态框在页面上只有一个实例
    let modal = document.getElementById('tagManageModal');
    if (modal) {
        document.body.removeChild(modal);
    }
    
    // 创建模态框元素
    modal = document.createElement('div');
    modal.id = 'tagManageModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-40';
    
    // 当前使用的标签类型和默认标签
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    const currentTags = isMovie ? movieTags : tvTags;
    const defaultTags = isMovie ? defaultMovieTags : defaultTvTags;
    
    // 模态框内容
    modal.innerHTML = `
        <div class="bg-[#191919] rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto relative">
            <button id="closeTagModal" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>
            
            <h3 class="text-xl font-bold text-white mb-4">标签管理 (${isMovie ? '电影' : '电视剧'})</h3>
            
            <div class="mb-4">
                <div class="flex justify-between items-center mb-2">
                    <h4 class="text-lg font-medium text-gray-300">标签列表</h4>
                    <button id="resetTagsBtn" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded">
                        恢复默认标签
                    </button>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4" id="tagsGrid">
                    ${currentTags.length ? currentTags.map(tag => {
                        // "热门"标签不能删除
                        const canDelete = tag !== '热门';
                        return `
                            <div class="bg-[#1a1a1a] text-gray-300 py-1.5 px-3 rounded text-sm font-medium flex justify-between items-center group">
                                <span>${tag}</span>
                                ${canDelete ? 
                                    `<button class="delete-tag-btn text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" 
                                        data-tag="${tag}">✕</button>` : 
                                    `<span class="text-gray-500 text-xs italic opacity-0 group-hover:opacity-100">必需</span>`
                                }
                            </div>
                        `;
                    }).join('') : 
                    `<div class="col-span-full text-center py-4 text-gray-500">无标签，请添加或恢复默认</div>`}
                </div>
            </div>
            
            <div class="border-t border-gray-700 pt-4">
                <h4 class="text-lg font-medium text-gray-300 mb-3">添加新标签</h4>
                <form id="addTagForm" class="flex items-center">
                    <input type="text" id="newTagInput" placeholder="输入标签名称..." 
                           class="flex-1 bg-[#222] text-white border border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-pink-500">
                    <button type="submit" class="ml-2 bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded">添加</button>
                </form>
                <p class="text-xs text-gray-500 mt-2">提示：标签名称不能为空，不能重复，不能包含特殊字符</p>
            </div>
        </div>
    `;
    
    // 添加模态框到页面
    document.body.appendChild(modal);
    
    // 焦点放在输入框上
    setTimeout(() => {
        document.getElementById('newTagInput').focus();
    }, 100);
    
    // 添加事件监听器 - 关闭按钮
    document.getElementById('closeTagModal').addEventListener('click', function() {
        document.body.removeChild(modal);
    });
    
    // 添加事件监听器 - 点击模态框外部关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
    
    // 添加事件监听器 - 恢复默认标签按钮
    document.getElementById('resetTagsBtn').addEventListener('click', function() {
        resetTagsToDefault();
        showTagManageModal(); // 重新加载模态框
    });
    
    // 添加事件监听器 - 删除标签按钮
    const deleteButtons = document.querySelectorAll('.delete-tag-btn');
    deleteButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const tagToDelete = this.getAttribute('data-tag');
            deleteTag(tagToDelete);
            showTagManageModal(); // 重新加载模态框
        });
    });
    
    // 添加事件监听器 - 表单提交
    document.getElementById('addTagForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const input = document.getElementById('newTagInput');
        const newTag = input.value.trim();
        
        if (newTag) {
            addTag(newTag);
            input.value = '';
            showTagManageModal(); // 重新加载模态框
        }
    });
}

// 添加标签
function addTag(tag) {
    // 安全处理标签名，防止XSS
    const safeTag = tag
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    
    // 确定当前使用的是电影还是电视剧标签
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    const currentTags = isMovie ? movieTags : tvTags;
    
    // 检查是否已存在（忽略大小写）
    const exists = currentTags.some(
        existingTag => existingTag.toLowerCase() === safeTag.toLowerCase()
    );
    
    if (exists) {
        showToast('标签已存在', 'warning');
        return;
    }
    
    // 添加到对应的标签数组
    if (isMovie) {
        movieTags.push(safeTag);
    } else {
        tvTags.push(safeTag);
    }
    
    // 保存到本地存储
    saveUserTags();
    
    // 重新渲染标签
    renderDoubanTags();
    
    showToast('标签添加成功', 'success');
}

// 删除标签
function deleteTag(tag) {
    // 热门标签不能删除
    if (tag === '热门') {
        showToast('热门标签不能删除', 'warning');
        return;
    }
    
    // 确定当前使用的是电影还是电视剧标签
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    const currentTags = isMovie ? movieTags : tvTags;
    
    // 寻找标签索引
    const index = currentTags.indexOf(tag);
    
    // 如果找到标签，则删除
    if (index !== -1) {
        currentTags.splice(index, 1);
        
        // 保存到本地存储
        saveUserTags();
        
        // 如果当前选中的是被删除的标签，则重置为"热门"
        if (doubanCurrentTag === tag) {
            doubanCurrentTag = '热门';
            doubanPageStart = 0;
            renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
        }
        
        // 重新渲染标签
        renderDoubanTags();
        
        showToast('标签删除成功', 'success');
    }
}

// 重置为默认标签
function resetTagsToDefault() {
    // 确定当前使用的是电影还是电视剧
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    
    // 重置为默认标签
    if (isMovie) {
        movieTags = [...defaultMovieTags];
    } else {
        tvTags = [...defaultTvTags];
    }
    
    // 设置当前标签为热门
    doubanCurrentTag = '热门';
    doubanPageStart = 0;
    
    // 保存到本地存储
    saveUserTags();
    
    // 重新渲染标签和内容
    renderDoubanTags();
    renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
    
    showToast('已恢复默认标签', 'success');
}
