// 当文档加载完成后执行
$(document).ready(function() {
    // 存储活跃的翻译任务信息
    let activeTranslations = {};
    
    // 检查上传文件夹内容，查找可能正在进行翻译的文件
    checkActiveTranslations();
    
    // 每10秒检查一次活跃的翻译任务
    setInterval(checkActiveTranslations, 10000);
    
    // 检查正在进行的翻译任务
    function checkActiveTranslations() {
        $.ajax({
            url: '/list_uploads',
            type: 'GET',
            success: function(response) {
                if (response.status === 'success' && response.uploads && response.uploads.length > 0) {
                    // 循环检查每个上传的PDF文件是否正在翻译
                    response.uploads.forEach(function(filename) {
                        checkFileProgress(filename);
                    });
                }
            }
        });
    }
    
    // 检查特定文件的翻译进度
    function checkFileProgress(filename) {
        $.ajax({
            url: '/check_progress/' + filename,
            type: 'GET',
            success: function(response) {
                if (response.status === 'in_progress' || response.status === 'finalizing') {
                    // 更新或添加到活跃翻译列表
                    updateActiveTranslation(filename, response);
                } else if (response.status === 'completed') {
                    // 如果翻译完成，从活跃列表中移除
                    removeActiveTranslation(filename);
                    // 刷新页面以显示新的已翻译文件（可选）
                    // window.location.reload();
                } else if (activeTranslations[filename]) {
                    // 如果之前在列表中但现在不是活跃状态，移除
                    removeActiveTranslation(filename);
                }
            }
        });
    }
    
    // 更新活跃翻译任务的显示
    function updateActiveTranslation(filename, progressData) {
        // 添加到跟踪对象
        activeTranslations[filename] = progressData;
        
        // 显示活跃翻译卡片
        $('#active-translations-card').show();
        
        // 检查是否已经有这个文件的进度条
        const taskId = 'task-' + filename.replace(/\./g, '-');
        let taskElement = $('#' + taskId);
        
        if (taskElement.length === 0) {
            // 创建新的任务元素
            taskElement = $(`
                <div id="${taskId}" class="list-group-item">
                    <div class="d-flex align-items-center mb-2">
                        <i class="fas fa-file-pdf text-danger me-2"></i>
                        <span class="task-name">${filename}</span>
                    </div>
                    <div class="progress" style="height: 20px;">
                        <div class="progress-bar progress-bar-striped progress-bar-animated" 
                             role="progressbar" style="width: 0%;" 
                             aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                    <div class="progress-text mt-2 text-center"></div>
                </div>
            `);
            $('#active-translations-list').append(taskElement);
        }
        
        // 更新进度数据
        let percentage = 0;
        let statusText = '';
        
        if (progressData.status === 'in_progress') {
            percentage = progressData.percentage || 0;
            statusText = `已完成: ${progressData.completed}/${progressData.total} (${percentage.toFixed(1)}%)`;
        } else if (progressData.status === 'finalizing') {
            percentage = 99;
            statusText = progressData.message || '正在处理最终结果...';
        }
        
        // 更新UI
        taskElement.find('.progress-bar').css('width', percentage + '%').attr('aria-valuenow', percentage);
        taskElement.find('.progress-text').text(statusText);
    }
    
    // 从活跃列表中移除翻译任务
    function removeActiveTranslation(filename) {
        // 从跟踪对象中移除
        delete activeTranslations[filename];
        
        // 从UI中移除
        const taskId = 'task-' + filename.replace(/\./g, '-');
        $('#' + taskId).fadeOut(300, function() {
            $(this).remove();
            
            // 如果没有活跃任务，隐藏卡片
            if (Object.keys(activeTranslations).length === 0) {
                $('#active-translations-card').hide();
            }
        });
    }
}); 