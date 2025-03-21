// 当文档加载完成后执行
$(document).ready(function() {
    // 初始化提示
    $('[data-bs-toggle="tooltip"]').tooltip();
    
    // 加载文档预览
    loadDocumentPreview();
    
    // 清除缓存功能
    $('#clear-cache-btn').on('click', function() {
        if (!confirm('确定要清除所有缓存文件吗？这将删除所有上传的PDF和翻译结果。')) {
            return;
        }
        
        $(this).prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> 清除中...');
        
        const resultDiv = $('#clear-cache-result');
        
        // 发送清除缓存请求
        $.ajax({
            url: '/clear_cache',
            type: 'POST',
            success: function(response) {
                $('#clear-cache-btn').prop('disabled', false).html('<i class="fas fa-trash-alt"></i> 清除所有缓存');
                
                resultDiv.removeClass('d-none alert-success alert-danger');
                if (response.status === 'success') {
                    resultDiv.addClass('alert-success');
                    resultDiv.html('<i class="fas fa-check-circle"></i> ' + response.message);
                    // 清除localStorage中保存的API密钥
                    localStorage.removeItem('deepseek_api_key');
                    $('#api_key').val('');
                    // 3秒后返回主页
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 3000);
                } else {
                    resultDiv.addClass('alert-danger');
                    resultDiv.html('<i class="fas fa-exclamation-circle"></i> ' + response.message);
                }
            },
            error: function(xhr, status, error) {
                $('#clear-cache-btn').prop('disabled', false).html('<i class="fas fa-trash-alt"></i> 清除所有缓存');
                resultDiv.removeClass('d-none').addClass('alert-danger');
                resultDiv.html('<i class="fas fa-exclamation-circle"></i> 请求失败: ' + error);
            }
        });
    });
    
    // 预览切换事件
    $('#toggle-preview').on('click', function() {
        const $previewContent = $('#preview-content');
        const $icon = $(this).find('i');
        
        if ($previewContent.hasClass('d-none')) {
            $previewContent.removeClass('d-none');
            $icon.removeClass('fa-chevron-down').addClass('fa-chevron-up');
            $(this).html('<i class="fas fa-chevron-up"></i> 收起');
        } else {
            $previewContent.addClass('d-none');
            $icon.removeClass('fa-chevron-up').addClass('fa-chevron-down');
            $(this).html('<i class="fas fa-chevron-down"></i> 展开');
        }
    });
    
    // 开始翻译按钮点击事件
    $('#start-translation').on('click', function() {
        // 验证API密钥
        const apiKey = $('#api_key').val().trim();
        if (!apiKey) {
            showError('请输入API密钥');
            return;
        }
        
        // 显示进度容器
        $('#progress-container').removeClass('d-none');
        // 禁用开始翻译按钮
        $(this).prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> 处理中...');
        
        // 获取表单数据
        const formData = new FormData($('#translation-form')[0]);
        
        // 发送翻译请求
        $.ajax({
            url: '/start_translation',
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            success: function(response) {
                if (response.status === 'success') {
                    // 初始化进度检查
                    updateProgressBar(0, '初始化翻译中...');
                    setTimeout(() => {
                        checkProgress(formData.get('filename'));
                    }, 2000);
                } else {
                    showError(response.message || '翻译失败，请重试');
                    resetForm();
                }
            },
            error: function(xhr, status, error) {
                showError('服务器错误，请重试');
                console.error(error);
                resetForm();
            }
        });
    });
    
    // 检查翻译进度
    function checkProgress(filename) {
        $.ajax({
            url: '/check_progress/' + filename,
            type: 'GET',
            success: function(response) {
                console.log('Progress check response:', response); // 调试日志
                
                if (response.status === 'in_progress') {
                    // 更新进度条
                    updateProgressBar(response.percentage, `已完成: ${response.completed}/${response.total} (${response.percentage.toFixed(1)}%)`);
                    
                    // 继续检查进度
                    setTimeout(function() {
                        checkProgress(filename);
                    }, 2000);
                } else if (response.status === 'completed') {
                    // 显示完成状态
                    updateProgressBar(100, '翻译完成!');
                    showCompleted(response.output_file);
                } else if (response.status === 'finalizing') {
                    // 显示正在完成的状态
                    updateProgressBar(99, response.message || '正在处理最终结果...');
                    // 继续检查进度
                    setTimeout(function() {
                        checkProgress(filename);
                    }, 2000);
                } else if (response.status === 'error') {
                    showError(response.message || '翻译过程中发生错误');
                    resetForm();
                } else {
                    // 未开始或未知状态，继续检查
                    updateProgressBar(0, '等待任务开始...');
                    setTimeout(function() {
                        checkProgress(filename);
                    }, 3000);
                }
            },
            error: function(xhr, status, error) {
                console.error('Progress check error:', error, xhr.responseText); // 调试日志
                showError('检查进度时发生错误');
                
                // 继续检查，除非是严重错误
                setTimeout(function() {
                    checkProgress(filename);
                }, 5000);
            }
        });
    }
    
    // 更新进度条
    function updateProgressBar(percentage, text) {
        console.log('Updating progress bar:', percentage, text); // 调试日志
        
        // 确保百分比是数字且在0-100范围内
        percentage = Math.min(100, Math.max(0, parseFloat(percentage) || 0));
        
        $('#progress-bar').css('width', percentage + '%').attr('aria-valuenow', percentage);
        $('#progress-text').text(text);
        
        // 如果进度是0，添加一点动画效果
        if (percentage === 0) {
            $('#progress-bar').addClass('progress-bar-animated');
        } else if (percentage === 100) {
            $('#progress-bar').removeClass('progress-bar-animated');
        }
    }
    
    // 显示完成状态
    function showCompleted(outputFile) {
        $('#completed-container').removeClass('d-none').addClass('fade-in');
        $('#download-link').attr('href', '/download/' + outputFile);
        $('#start-translation').prop('disabled', false).html('<i class="fas fa-play-circle"></i> 开始翻译');
    }
    
    // 显示错误消息
    function showError(message) {
        $('#progress-text').html(`<div class="alert alert-danger"><i class="fas fa-exclamation-circle"></i> ${message}</div>`);
    }
    
    // 重置表单状态
    function resetForm() {
        $('#start-translation').prop('disabled', false).html('<i class="fas fa-play-circle"></i> 开始翻译');
    }
    
    // 加载文档预览
    function loadDocumentPreview() {
        const filename = $('#filename').val();
        
        $.ajax({
            url: '/preview/' + filename,
            type: 'GET',
            success: function(response) {
                if (response.status === 'success') {
                    renderPreview(response.preview);
                } else {
                    $('#preview-content').html(
                        `<div class="alert alert-warning"><i class="fas fa-exclamation-triangle"></i> 无法加载预览: ${response.message}</div>`
                    );
                }
            },
            error: function() {
                $('#preview-content').html(
                    `<div class="alert alert-danger"><i class="fas fa-exclamation-circle"></i> 预览加载失败</div>`
                );
            }
        });
    }
    
    // 渲染预览内容
    function renderPreview(previewData) {
        const $previewContent = $('#preview-content');
        $previewContent.empty();
        
        if (!previewData || !previewData.previews || previewData.previews.length === 0) {
            $previewContent.html('<div class="alert alert-warning">没有可用的预览内容</div>');
            return;
        }
        
        const $container = $('<div class="preview-container"></div>');
        $previewContent.append($container);
        
        // 添加页面总数信息
        $container.append(`<div class="mb-3 text-muted">文档共 ${previewData.total_pages} 页，以下是前几页预览：</div>`);
        
        // 逐页添加预览内容
        previewData.previews.forEach(pagePreview => {
            const $pageTemplate = $(document.getElementById('preview-template').content.cloneNode(true));
            $pageTemplate.find('.page-number').text(pagePreview.page);
            
            const $paragraphsContainer = $pageTemplate.find('.preview-paragraphs');
            
            pagePreview.paragraphs.forEach(paragraph => {
                const $paragraph = $(document.getElementById('paragraph-template').content.cloneNode(true));
                $paragraph.find('.preview-paragraph').text(paragraph);
                $paragraphsContainer.append($paragraph);
            });
            
            $container.append($pageTemplate);
        });
    }
    
    // 并行进程数和批处理大小相关提示
    $('#max_concurrent').on('change', function() {
        const value = $(this).val();
        if (parseInt(value) > 3) {
            $('.translation-tips').html('<i class="fas fa-info-circle"></i> <span>提示：高并行进程数将显著增加API调用频率，请确保您的API密钥有足够的配额。</span>');
        } else {
            updateTips();
        }
    });
    
    $('#batch_size').on('change', function() {
        const value = $(this).val();
        if (parseInt(value) > 5) {
            $('.translation-tips').html('<i class="fas fa-info-circle"></i> <span>提示：较大的批处理大小可能会降低翻译质量，尤其是对于复杂文本。</span>');
        } else {
            updateTips();
        }
    });

    $('#sentences_per_paragraph').on('change', function() {
        updateTips();
    });

    function updateTips() {
        const sentences = $('#sentences_per_paragraph').val();
        const batch = $('#batch_size').val();
        const concurrent = $('#max_concurrent').val();
        
        // 根据选择的组合提供不同的提示
        if (parseInt(sentences) <= 2) {
            $('.translation-tips').html('<i class="fas fa-info-circle"></i> <span>提示：较短的段落分割可提高翻译准确性但会增加API调用次数。如文本较长可适当增加每段句子数。</span>');
        } else if (parseInt(sentences) >= 6) {
            $('.translation-tips').html('<i class="fas fa-info-circle"></i> <span>提示：较长的段落分割有助于保持上下文连贯，但对复杂文本可能导致翻译质量降低。</span>');
        } else {
            $('.translation-tips').html('<i class="fas fa-info-circle"></i> <span>提示：当前设置适合大多数文档。句号后有换行符的句子将单独成段，其他句子按每' + sentences + '句组成一段。</span>');
        }
    }
}); 