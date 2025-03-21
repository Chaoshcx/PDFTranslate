import os
import asyncio
import json
import shutil
from flask import Flask, request, render_template, redirect, url_for, flash, send_from_directory, jsonify
from werkzeug.utils import secure_filename
import tempfile
from pathlib import Path

# 导入现有翻译脚本的函数
from importlib.util import spec_from_file_location, module_from_spec

# 获取当前目录
current_dir = os.path.dirname(os.path.abspath(__file__))

# 动态导入翻译脚本
translator_path = os.path.join(current_dir, "#Book TranslateV1.py")
spec = spec_from_file_location("translator", translator_path)
translator = module_from_spec(spec)
spec.loader.exec_module(translator)

app = Flask(__name__)
app.secret_key = 'translation_secret_key'  # 用于flash消息
app.config['UPLOAD_FOLDER'] = os.path.join(current_dir, 'uploads')
app.config['OUTPUT_FOLDER'] = os.path.join(current_dir, 'outputs')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB最大上传限制

# 确保上传和输出目录存在
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['OUTPUT_FOLDER'], exist_ok=True)

# 允许的文件类型
ALLOWED_EXTENSIONS = {'pdf'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/')
def index():
    # 获取已经翻译完成的文件列表
    translated_files = []
    for filename in os.listdir(app.config['OUTPUT_FOLDER']):
        if filename.endswith('.docx'):
            translated_files.append(filename)
    
    return render_template('index.html', translated_files=translated_files)

@app.route('/upload', methods=['POST'])
def upload_file():
    # 检查是否有文件
    if 'file' not in request.files:
        flash('没有选择文件')
        return redirect(request.url)
    
    file = request.files['file']
    
    # 如果用户没有选择文件
    if file.filename == '':
        flash('没有选择文件')
        return redirect(request.url)
    
    if file and allowed_file(file.filename):
        # 保存上传的文件
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # 重定向到翻译页面
        return redirect(url_for('translate_page', filename=filename))
    else:
        flash('只允许上传PDF文件')
        return redirect(url_for('index'))

@app.route('/preview/<filename>')
def get_preview(filename):
    """获取PDF文件预览内容"""
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(filepath):
        return jsonify({'status': 'error', 'message': '文件不存在'})
    
    try:
        # 调用translator的预览功能
        preview_data = translator.get_pdf_preview(filepath)
        return jsonify({
            'status': 'success',
            'preview': preview_data
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/translate/<filename>')
def translate_page(filename):
    # 显示翻译选项页面
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(filepath):
        flash('文件不存在')
        return redirect(url_for('index'))
    
    return render_template('translate.html', filename=filename)

@app.route('/start_translation', methods=['POST'])
def start_translation():
    filename = request.form.get('filename')
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    if not os.path.exists(filepath):
        return jsonify({'status': 'error', 'message': '文件不存在'})
    
    # 获取翻译设置
    api_key = request.form.get('api_key', '')
    if not api_key:
        return jsonify({'status': 'error', 'message': '请输入API密钥'})
        
    batch_size = int(request.form.get('batch_size', translator.DEFAULT_CONFIG['batch_size']))
    max_concurrent = int(request.form.get('max_concurrent', translator.DEFAULT_CONFIG['max_concurrent_requests']))
    comparison_mode = request.form.get('comparison_mode') == 'on'
    sentences_per_paragraph = int(request.form.get('sentences_per_paragraph', 4))
    
    # 确保并行进程数在1-5之间
    max_concurrent = max(1, min(5, max_concurrent))
    # 确保每段句子数在合理范围内
    sentences_per_paragraph = max(1, min(10, sentences_per_paragraph))
    
    # 设置输出路径
    output_filename = f"translated_{os.path.splitext(filename)[0]}.docx"
    output_path = os.path.join(app.config['OUTPUT_FOLDER'], output_filename)
    
    # 设置进度文件
    progress_filename = f"progress_{os.path.splitext(filename)[0]}.json"
    progress_path = os.path.join(app.config['OUTPUT_FOLDER'], progress_filename)
    
    # 创建进度初始化
    text = translator.extract_text_from_pdf(filepath)
    paragraphs = translator.split_paragraphs_by_sentences(text, sentences_per_paragraph)
    
    # 初始化进度文件
    progress_data = {
        'total': len(paragraphs),
        'processed': [],
        'batch_size': batch_size
    }
    
    with open(progress_path, 'w', encoding='utf-8') as f:
        json.dump(progress_data, f)
    
    # 启动异步翻译任务（这里使用线程而不是协程，避免阻塞Flask）
    import threading
    thread = threading.Thread(
        target=lambda: asyncio.run(process_translation(
            filepath, api_key, output_path, progress_path, 
            comparison_mode, batch_size, max_concurrent, sentences_per_paragraph
        ))
    )
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'status': 'success', 
        'message': '翻译已启动',
        'total_paragraphs': len(paragraphs)
    })

@app.route('/check_progress/<filename>')
def check_progress(filename):
    """检查翻译进度"""
    try:
        # 检查翻译进度
        progress_filename = f"progress_{os.path.splitext(filename)[0]}.json"
        progress_path = os.path.join(app.config['OUTPUT_FOLDER'], progress_filename)
        
        # 检查输出文件是否存在
        output_filename = f"translated_{os.path.splitext(filename)[0]}.docx"
        output_path = os.path.join(app.config['OUTPUT_FOLDER'], output_filename)
        
        # 调试信息
        print(f"检查进度: {filename}, 进度文件: {progress_path}, 输出文件: {output_path}")
        
        if os.path.exists(output_path):
            # 如果输出文件存在并且大于零字节，认为翻译已完成
            if os.path.getsize(output_path) > 0:
                print(f"翻译已完成，输出文件大小: {os.path.getsize(output_path)}")
                return jsonify({'status': 'completed', 'output_file': output_filename})
        
        if os.path.exists(progress_path):
            try:
                with open(progress_path, 'r', encoding='utf-8') as f:
                    progress_data = json.load(f)
                    # 计算完成百分比
                    if 'total' in progress_data and progress_data['total'] > 0:
                        completed = len(progress_data.get('processed', []))
                        percentage = (completed / progress_data['total']) * 100
                        
                        print(f"进度数据: 已完成 {completed}/{progress_data['total']} ({percentage:.1f}%)")
                        
                        # 如果进度已达到100%但输出文件还没有生成，显示"处理最终结果中"
                        if percentage >= 100 and not os.path.exists(output_path):
                            return jsonify({
                                'status': 'finalizing',
                                'message': '翻译已完成，正在处理最终结果...'
                            })
                        
                        return jsonify({
                            'status': 'in_progress',
                            'completed': completed,
                            'total': progress_data['total'],
                            'percentage': percentage
                        })
                    else:
                        print(f"进度数据无效: {progress_data}")
                        return jsonify({'status': 'error', 'message': '无效的进度数据'})
            except Exception as e:
                print(f"读取进度文件错误: {e}")
                return jsonify({'status': 'error', 'message': str(e)})
        else:
            print(f"进度文件不存在: {progress_path}")
        
        return jsonify({'status': 'not_started'})
    except Exception as e:
        print(f"检查进度时发生错误: {e}")
        return jsonify({'status': 'error', 'message': f"服务器错误: {str(e)}"})

@app.route('/download/<filename>')
def download_file(filename):
    return send_from_directory(app.config['OUTPUT_FOLDER'], filename, as_attachment=True)

@app.route('/test_api', methods=['POST'])
def test_api():
    """API测试功能"""
    try:
        data = request.json
        api_key = data.get('api_key')
        text = data.get('text')
        
        if not api_key:
            return jsonify({'status': 'error', 'message': '请提供API密钥'})
        
        if not text:
            return jsonify({'status': 'error', 'message': '请提供测试文本'})
        
        # 调用DeepSeek API进行测试
        translated_text = translator.translate_with_deepseek(
            [text], 
            api_key=api_key,
            api_url=translator.DEFAULT_CONFIG['api_url'],
            api_model=translator.DEFAULT_CONFIG['api_model']
        )
        
        if not translated_text:
            return jsonify({'status': 'error', 'message': 'API调用失败，请检查密钥是否正确'})
        
        return jsonify({
            'status': 'success',
            'translation': translated_text
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'发生错误: {str(e)}'})

@app.route('/clear_cache', methods=['POST'])
def clear_cache():
    """清除所有缓存文件，包括上传文件、输出文件和进度文件"""
    try:
        # 清除上传文件夹
        for filename in os.listdir(app.config['UPLOAD_FOLDER']):
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            if os.path.isfile(file_path):
                os.unlink(file_path)
        
        # 清除输出文件夹
        for filename in os.listdir(app.config['OUTPUT_FOLDER']):
            file_path = os.path.join(app.config['OUTPUT_FOLDER'], filename)
            if os.path.isfile(file_path):
                os.unlink(file_path)
        
        return jsonify({'status': 'success', 'message': '缓存已清除'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'清除缓存时发生错误: {str(e)}'})

@app.route('/list_uploads')
def list_uploads():
    """列出上传文件夹中的PDF文件，用于前端检查翻译进度"""
    try:
        uploads = []
        for filename in os.listdir(app.config['UPLOAD_FOLDER']):
            if filename.lower().endswith('.pdf'):
                uploads.append(filename)
        
        return jsonify({'status': 'success', 'uploads': uploads})
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'获取上传文件列表失败: {str(e)}'})

async def process_translation(pdf_path, api_key, output_path, progress_path, 
                             comparison_mode=False, batch_size=3, max_concurrent=3,
                             sentences_per_paragraph=4):
    """处理翻译任务的包装函数"""
    try:
        # 调用异步翻译函数
        await translator.main_async(
            pdf_path=pdf_path,
            api_key=api_key,
            output_path=output_path,
            progress_file=progress_path,
            start_page=1,  # 从第一页开始
            end_page=None,  # 翻译全部内容
            comparison_mode=comparison_mode,
            batch_size=batch_size,
            max_concurrent_requests=max_concurrent,
            sentences_per_paragraph=sentences_per_paragraph
        )
        
        return True
    except Exception as e:
        print(f"翻译处理错误: {e}")
        return False

if __name__ == '__main__':
    app.run(debug=True) 